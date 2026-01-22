import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Rfq = {
  id: string;
  rfq_no: string;
  vendor_id: string;
  requested_on: string;
  needed_by: string | null;
  deliver_to_warehouse_id: string | null;
  status: string;
  notes: string | null;
};

type Vendor = {
  id: string;
  legal_name: string;
};

type Variant = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
};

type Warehouse = {
  id: string;
  name: string;
};

type RfqLine = {
  id: string;
  variant_id: string;
  qty: number;
  notes: string | null;
};

type QuoteSummary = {
  id: string;
  quote_no: string;
  status: string;
};

type LineDraft = {
  variant_id: string;
  qty: string;
  notes: string;
};

export default function RfqDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [quote, setQuote] = useState<QuoteSummary | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [requestedOn, setRequestedOn] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [deliverToWarehouseId, setDeliverToWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);
  const canEdit = canWrite && rfq?.status === "draft";

  useEffect(() => {
    if (!id) return;
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadData(context.companyId, id as string, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  async function loadData(companyId: string, rfqId: string, isActiveFetch = true) {
    setError("");
    setNotice("");
    const [rfqRes, lineRes, vendorRes, variantRes, warehouseRes, quoteRes] = await Promise.all([
      supabase
        .from("erp_rfq")
        .select("id, rfq_no, vendor_id, requested_on, needed_by, deliver_to_warehouse_id, status, notes")
        .eq("company_id", companyId)
        .eq("id", rfqId)
        .single(),
      supabase
        .from("erp_rfq_lines")
        .select("id, variant_id, qty, notes")
        .eq("company_id", companyId)
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title)")
        .eq("company_id", companyId)
        .order("sku"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
      supabase
        .from("erp_vendor_quotes")
        .select("id, quote_no, status")
        .eq("company_id", companyId)
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (rfqRes.error || lineRes.error || vendorRes.error || variantRes.error || warehouseRes.error || quoteRes.error) {
      if (isActiveFetch) {
        setError(
          rfqRes.error?.message ||
            lineRes.error?.message ||
            vendorRes.error?.message ||
            variantRes.error?.message ||
            warehouseRes.error?.message ||
            quoteRes.error?.message ||
            "Failed to load RFQ."
        );
      }
      return;
    }

    if (isActiveFetch) {
      const rfqData = rfqRes.data as Rfq;
      setRfq(rfqData);
      setVendorId(rfqData.vendor_id);
      setRequestedOn(rfqData.requested_on);
      setNeededBy(rfqData.needed_by || "");
      setDeliverToWarehouseId(rfqData.deliver_to_warehouse_id || "");
      setNotes(rfqData.notes || "");

      const lineRows = (lineRes.data || []) as RfqLine[];
      setLines(
        lineRows.map((line) => ({
          variant_id: line.variant_id,
          qty: String(line.qty),
          notes: line.notes || "",
        }))
      );

      setVendors((vendorRes.data || []) as Vendor[]);
      const variantRows = (variantRes.data || []) as Array<{
        id: string;
        sku: string;
        size: string | null;
        color: string | null;
        erp_products?: { title?: string | null } | null;
      }>;
      setVariants(
        variantRows.map((row) => ({
          id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          productTitle: row.erp_products?.title || "",
        }))
      );
      setWarehouses((warehouseRes.data || []) as Warehouse[]);
      setQuote(quoteRes.data ? (quoteRes.data as QuoteSummary) : null);
    }
  }

  function updateLine(index: number, next: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { variant_id: "", qty: "", notes: "" }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId || !rfq) return;
    if (!canEdit) {
      setError("Only owner/admin can edit draft RFQs.");
      return;
    }

    const normalizedLines = lines
      .map((line) => ({
        variant_id: line.variant_id,
        qty: Number(line.qty),
        notes: line.notes.trim() || null,
      }))
      .filter((line) => line.variant_id && Number.isFinite(line.qty) && line.qty > 0);

    if (normalizedLines.length === 0) {
      setError("Add at least one line with a valid quantity.");
      return;
    }

    setError("");
    setNotice("");

    const { error: rfqError } = await supabase.rpc("erp_inventory_rfq_update", {
      p_rfq_id: rfq.id,
      p_vendor_id: vendorId,
      p_requested_on: requestedOn,
      p_needed_by: neededBy || null,
      p_deliver_to_warehouse_id: deliverToWarehouseId || null,
      p_notes: notes.trim() || null,
    });

    if (rfqError) {
      setError(rfqError.message);
      return;
    }

    const { error: lineError } = await supabase.rpc("erp_inventory_rfq_lines_replace", {
      p_rfq_id: rfq.id,
      p_lines: normalizedLines.map((line) => ({
        variant_id: line.variant_id,
        qty: line.qty,
        notes: line.notes,
      })),
    });

    if (lineError) {
      setError(lineError.message);
      return;
    }

    setNotice("RFQ updated.");
    await loadData(ctx.companyId, rfq.id);
  }

  async function handleMarkSent() {
    if (!ctx?.companyId || !rfq) return;
    if (!canEdit) {
      setError("Only owner/admin can mark RFQs as sent.");
      return;
    }

    setError("");
    const { error: updateError } = await supabase.rpc("erp_inventory_rfq_mark_sent", {
      p_rfq_id: rfq.id,
    });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadData(ctx.companyId, rfq.id);
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const formatVariantLabel = (variantId: string) => {
    const variant = variantMap.get(variantId);
    if (!variant) return "";
    const details = [variant.color, variant.size].filter(Boolean).join(" / ");
    return `${variant.sku} — ${variant.productTitle}${details ? ` (${details})` : ""}`;
  };

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading RFQ…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>RFQ {rfq?.rfq_no || ""}</h1>
            <p style={subtitleStyle}>Review vendor enquiry details and capture responses.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {rfq ? (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => window.open(`/erp/inventory/rfqs/${rfq.id}/print`, "_blank")}
              >
                Print / Save PDF
              </button>
            ) : null}
            {rfq ? (
              <Link href="/erp/inventory/rfqs" style={secondaryButtonStyle}>
                Back to RFQs
              </Link>
            ) : null}
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Status</div>
              <div style={{ fontWeight: 600 }}>{rfq?.status || "—"}</div>
            </div>
            {quote ? (
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Linked Quote</div>
                <Link href={`/erp/inventory/quotes/${quote.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                  {quote.quote_no}
                </Link>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{quote.status}</div>
              </div>
            ) : null}
          </div>
        </section>

        <section style={cardStyle}>
          <form onSubmit={handleSave} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                Vendor
                <select
                  style={inputStyle}
                  value={vendorId}
                  onChange={(event) => setVendorId(event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Requested On
                <input
                  style={inputStyle}
                  type="date"
                  value={requestedOn}
                  onChange={(event) => setRequestedOn(event.target.value)}
                  disabled={!canEdit}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Needed By
                <input
                  style={inputStyle}
                  type="date"
                  value={neededBy}
                  onChange={(event) => setNeededBy(event.target.value)}
                  disabled={!canEdit}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Deliver To
                <select
                  style={inputStyle}
                  value={deliverToWarehouseId}
                  onChange={(event) => setDeliverToWarehouseId(event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">Select warehouse</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              Notes
              <textarea
                style={{ ...inputStyle, minHeight: 90 }}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!canEdit}
              />
            </label>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>RFQ Lines</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>SKU</th>
                    <th style={tableHeaderCellStyle}>Qty</th>
                    <th style={tableHeaderCellStyle}>Notes</th>
                    <th style={tableHeaderCellStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.variant_id}-${index}`}>
                      <td style={tableCellStyle}>
                        <select
                          style={inputStyle}
                          value={line.variant_id}
                          onChange={(event) => updateLine(index, { variant_id: event.target.value })}
                          disabled={!canEdit}
                        >
                          <option value="">Select SKU</option>
                          {variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {formatVariantLabel(variant.id)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min="0"
                          value={line.qty}
                          onChange={(event) => updateLine(index, { qty: event.target.value })}
                          disabled={!canEdit}
                        />
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          value={line.notes}
                          onChange={(event) => updateLine(index, { notes: event.target.value })}
                          disabled={!canEdit}
                        />
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {canEdit && lines.length > 1 ? (
                          <button type="button" style={secondaryButtonStyle} onClick={() => removeLine(index)}>
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {canEdit ? (
                <button type="button" style={{ ...secondaryButtonStyle, marginTop: 12 }} onClick={addLine}>
                  Add Line
                </button>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canEdit}>
                Save Draft
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleMarkSent} disabled={!canEdit}>
                Mark Sent
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => rfq && router.push(`/erp/inventory/quotes/new?rfq=${rfq.id}`)}
                disabled={!rfq}
              >
                Create Quote
              </button>
            </div>
          </form>
        </section>
      </div>
    </ErpShell>
  );
}
