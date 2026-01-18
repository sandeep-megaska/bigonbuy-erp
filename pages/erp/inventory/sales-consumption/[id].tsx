import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import InventoryLinesEditor, { type InventoryLine } from "../../../../components/inventory/InventoryLinesEditor";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import type { VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

type SalesChannel = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type SalesConsumptionHeader = {
  id: string;
  status: string;
  consumption_date: string;
  channel_id: string;
  warehouse_id: string;
  reference: string | null;
  notes: string | null;
  posted_at: string | null;
};

type SalesConsumptionLine = {
  id: string;
  variant_id: string;
  qty: number;
};

const salesChannelsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
  })
);

const consumptionGetSchema = z.object({
  header: z.object({
    id: z.string().uuid(),
    status: z.string(),
    consumption_date: z.string(),
    channel_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    posted_at: z.string().nullable(),
  }),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      variant_id: z.string().uuid(),
      qty: z.number(),
    })
  ),
});

const postResponseSchema = z.object({
  ok: z.boolean(),
  posted_lines: z.number(),
});

const createLineId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createEmptyLine(): InventoryLine {
  return {
    id: createLineId(),
    variant_id: "",
    qty: "",
    variant: null,
  };
}

export default function SalesConsumptionDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<SalesConsumptionHeader | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [lines, setLines] = useState<InventoryLine[]>([createEmptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);
  const isDraft = consumption?.status === "draft";

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (typeof id !== "string") {
        setLoading(false);
        return;
      }

      await loadConsumption(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadConsumption = useCallback(async (companyId: string, consumptionId: string, isActive = true) => {
    setError(null);
    setNotice(null);

    const [consumptionRes, warehouseRes, channelRes] = await Promise.all([
      supabase.rpc("erp_sales_consumption_get", { p_id: consumptionId }),
      supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId).order("name"),
      supabase.rpc("erp_sales_channels_list"),
    ]);

    if (consumptionRes.error || warehouseRes.error || channelRes.error) {
      if (isActive) {
        setError(
          consumptionRes.error?.message ||
            warehouseRes.error?.message ||
            channelRes.error?.message ||
            "Failed to load sales consumption."
        );
      }
      return;
    }

    const consumptionParse = consumptionGetSchema.safeParse(consumptionRes.data);
    if (!consumptionParse.success) {
      if (isActive) setError("Failed to parse sales consumption.");
      return;
    }

    const channelParse = salesChannelsSchema.safeParse(channelRes.data);
    if (!channelParse.success) {
      if (isActive) setError("Failed to parse sales channels.");
      return;
    }

    const consumptionHeader = consumptionParse.data.header as SalesConsumptionHeader;
    const lineRows = consumptionParse.data.lines as SalesConsumptionLine[];

    const variantIds = lineRows.map((line) => line.variant_id);
    let variantMap = new Map<string, VariantSearchResult>();

    if (variantIds.length > 0) {
      const { data: variantRows, error: variantError } = await supabase
        .from("erp_variants")
        .select("id, sku, size, color, product_id, erp_products(title, hsn_code, style_code)")
        .in("id", variantIds);

      if (variantError) {
        if (isActive) setError(variantError.message || "Failed to load variants.");
        return;
      }

      (variantRows || []).forEach((row) => {
        const product = (row as { erp_products?: { title?: string | null; hsn_code?: string | null; style_code?: string | null } })
          .erp_products;
        variantMap.set(row.id, {
          variant_id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          product_id: row.product_id,
          style_code: product?.style_code ?? null,
          title: product?.title ?? null,
          hsn_code: product?.hsn_code ?? null,
        });
      });
    }

    if (isActive) {
      setConsumption(consumptionHeader);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setChannels(channelParse.data);
      if (lineRows.length > 0) {
        setLines(
          lineRows.map((line) => ({
            id: line.id,
            variant_id: line.variant_id,
            qty: line.qty.toString(),
            variant: variantMap.get(line.variant_id) || null,
          }))
        );
      } else {
        setLines([createEmptyLine()]);
      }
    }
  }, []);

  const handleAddLine = useCallback(() => {
    setLines((prev) => [...prev, createEmptyLine()]);
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== lineId)));
  }, []);

  const handleUpdateLine = useCallback((lineId: string, updates: Partial<InventoryLine>) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...updates } : line)));
  }, []);

  const validateLines = useCallback((lineItems: InventoryLine[]) => {
    const errors: Record<string, string> = {};
    const parsedLines: Array<{ variant_id: string; qty: number }> = [];

    lineItems.forEach((line) => {
      if (!line.variant_id) {
        errors[line.id] = "Select a SKU.";
        return;
      }
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors[line.id] = "Enter a quantity greater than 0.";
        return;
      }
      if (!Number.isInteger(qty)) {
        errors[line.id] = "Quantity must be a whole number.";
        return;
      }
      parsedLines.push({
        variant_id: line.variant_id,
        qty,
      });
    });

    return { errors, parsedLines };
  }, []);

  const lineSnapshot = useMemo(() => validateLines(lines), [lines, validateLines]);
  const hasLineErrors = Object.keys(lineSnapshot.errors).length > 0;
  const hasValidLines = lineSnapshot.parsedLines.length > 0;

  const handleSaveDraft = useCallback(async () => {
    if (!consumption || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to update sales consumptions.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_sales_consumption_update_header", {
      p_id: consumption.id,
      p_channel_id: consumption.channel_id,
      p_warehouse_id: consumption.warehouse_id,
      p_date: consumption.consumption_date,
      p_reference: consumption.reference,
      p_notes: consumption.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update sales consumption header.");
      setSaving(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_sales_consumption_save_lines", {
      p_id: consumption.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save sales consumption lines.");
      setSaving(false);
      return;
    }

    setNotice("Draft saved.");
    setSaving(false);
    await loadConsumption(ctx.companyId, consumption.id, true);
  }, [consumption, ctx?.companyId, canWrite, lines, validateLines, loadConsumption]);

  const handlePost = useCallback(async () => {
    if (!consumption || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post sales consumptions.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before posting.");
      return;
    }

    if (!window.confirm("Post this sales consumption? This cannot be undone.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_sales_consumption_update_header", {
      p_id: consumption.id,
      p_channel_id: consumption.channel_id,
      p_warehouse_id: consumption.warehouse_id,
      p_date: consumption.consumption_date,
      p_reference: consumption.reference,
      p_notes: consumption.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update sales consumption header.");
      setPosting(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_sales_consumption_save_lines", {
      p_id: consumption.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save sales consumption lines.");
      setPosting(false);
      return;
    }

    const { data, error: postError } = await supabase.rpc("erp_sales_consumption_post", {
      p_id: consumption.id,
    });

    if (postError) {
      setError(postError.message || "Failed to post sales consumption.");
      setPosting(false);
      return;
    }

    const parseResult = postResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse post response.");
      setPosting(false);
      return;
    }

    setNotice(`Sales consumption posted (${parseResult.data.posted_lines} lines).`);
    setPosting(false);
    await loadConsumption(ctx.companyId, consumption.id, true);
  }, [consumption, ctx?.companyId, canWrite, lines, validateLines, loadConsumption]);

  const updateHeader = useCallback((updates: Partial<SalesConsumptionHeader>) => {
    setConsumption((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading sales consumption…</div>
      </ErpShell>
    );
  }

  if (!consumption) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error || "Sales consumption not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Sales Consumption</p>
            <h1 style={h1Style}>Sales Consumption</h1>
            <p style={subtitleStyle}>Record channel dispatches and post stock-out entries.</p>
          </div>
          <div style={statusPillStyle}>{consumption.status}</div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={headerGridStyle}>
            <label style={{ display: "grid", gap: 6 }}>
              Consumption Date
              <input
                style={inputStyle}
                type="date"
                value={consumption.consumption_date}
                onChange={(event) => updateHeader({ consumption_date: event.target.value })}
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Channel
              <select
                style={inputStyle}
                value={consumption.channel_id}
                onChange={(event) => updateHeader({ channel_id: event.target.value })}
                disabled={!isDraft}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Warehouse
              <select
                style={inputStyle}
                value={consumption.warehouse_id}
                onChange={(event) => updateHeader({ warehouse_id: event.target.value })}
                disabled={!isDraft}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reference
              <input
                style={inputStyle}
                value={consumption.reference ?? ""}
                onChange={(event) => updateHeader({ reference: event.target.value })}
                placeholder="Batch ID / Settlement"
                disabled={!isDraft}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={consumption.notes ?? ""}
              onChange={(event) => updateHeader({ notes: event.target.value })}
              placeholder="Optional notes"
              disabled={!isDraft}
            />
          </label>
        </section>

        <section style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Lines</div>
          <InventoryLinesEditor
            lines={lines}
            lineErrors={lineErrors}
            onAddLine={handleAddLine}
            onRemoveLine={handleRemoveLine}
            onUpdateLine={handleUpdateLine}
            onVariantError={(message) => setError(message)}
            disabled={!isDraft}
          />
        </section>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleSaveDraft}
            disabled={!canWrite || !isDraft || saving}
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handlePost}
            disabled={!canWrite || !isDraft || posting || !hasValidLines || hasLineErrors}
          >
            {posting ? "Posting…" : "Post Consumption"}
          </button>
        </div>
      </div>
    </ErpShell>
  );
}

const headerGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};

const statusPillStyle = {
  padding: "6px 12px",
  borderRadius: 999,
  backgroundColor: "#ecfeff",
  color: "#0e7490",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase" as const,
};

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};

const noticeStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#ecfdf3",
  color: "#047857",
  fontSize: 14,
};
