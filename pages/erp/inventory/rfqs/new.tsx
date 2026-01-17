import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
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

type LineDraft = {
  variant_id: string;
  qty: string;
  notes: string;
};

export default function RfqCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [vendorId, setVendorId] = useState("");
  const [requestedOn, setRequestedOn] = useState(() => new Date().toISOString().split("T")[0]);
  const [neededBy, setNeededBy] = useState("");
  const [deliverToWarehouseId, setDeliverToWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ variant_id: "", qty: "", notes: "" }]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
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

      await loadData(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadData(companyId: string, isActiveFetch = true) {
    setError("");
    const [vendorRes, variantRes, warehouseRes] = await Promise.all([
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title)")
        .eq("company_id", companyId)
        .order("sku"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (vendorRes.error || variantRes.error || warehouseRes.error) {
      if (isActiveFetch) {
        setError(
          vendorRes.error?.message ||
            variantRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load RFQ data."
        );
      }
      return;
    }

    if (isActiveFetch) {
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
      if (vendorRes.data?.[0]?.id) setVendorId(vendorRes.data[0].id);
      if (warehouseRes.data?.[0]?.id) setDeliverToWarehouseId(warehouseRes.data[0].id);
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

  function resetForm() {
    setRequestedOn(new Date().toISOString().split("T")[0]);
    setNeededBy("");
    setNotes("");
    setLines([{ variant_id: "", qty: "", notes: "" }]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can create RFQs.");
      return;
    }
    if (!vendorId) {
      setError("Select a vendor to create an RFQ.");
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
    const { data: rfq, error: rfqError } = await supabase
      .from("erp_rfq")
      .insert({
        company_id: ctx.companyId,
        vendor_id: vendorId,
        requested_on: requestedOn,
        needed_by: neededBy || null,
        deliver_to_warehouse_id: deliverToWarehouseId || null,
        status: "draft",
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (rfqError) {
      setError(rfqError.message);
      return;
    }

    const { error: lineError } = await supabase.from("erp_rfq_lines").insert(
      normalizedLines.map((line) => ({
        company_id: ctx.companyId,
        rfq_id: rfq.id,
        variant_id: line.variant_id,
        qty: line.qty,
        notes: line.notes,
      }))
    );

    if (lineError) {
      setError(lineError.message);
      return;
    }

    resetForm();
    router.push(`/erp/inventory/rfqs/${rfq.id}`);
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
        <div style={pageContainerStyle}>Loading RFQ form…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>New RFQ</h1>
            <p style={subtitleStyle}>Capture vendor enquiry details before collecting a quote.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                Vendor
                <select style={inputStyle} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
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
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Needed By
                <input
                  style={inputStyle}
                  type="date"
                  value={neededBy}
                  onChange={(event) => setNeededBy(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Deliver To
                <select
                  style={inputStyle}
                  value={deliverToWarehouseId}
                  onChange={(event) => setDeliverToWarehouseId(event.target.value)}
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
                        />
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          value={line.notes}
                          onChange={(event) => updateLine(index, { notes: event.target.value })}
                        />
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {lines.length > 1 ? (
                          <button type="button" style={secondaryButtonStyle} onClick={() => removeLine(index)}>
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" style={{ ...secondaryButtonStyle, marginTop: 12 }} onClick={addLine}>
                Add Line
              </button>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite}>
                Save Draft
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => router.push("/erp/inventory/rfqs")}
              >
                Back to RFQs
              </button>
            </div>
          </form>
        </section>
      </div>
    </ErpShell>
  );
}
