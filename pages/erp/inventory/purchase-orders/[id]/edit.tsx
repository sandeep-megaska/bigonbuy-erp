import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  inputStyle,
} from "../../../../../components/erp/uiStyles";
import VariantTypeahead, { type VariantSearchResult } from "../../../../../components/inventory/VariantTypeahead";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type PurchaseOrder = {
  id: string;
  doc_no: string | null;
  po_no: string | null;
  vendor_id: string;
  status: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
};

type PurchaseOrderLine = {
  id: string;
  variant_id: string;
  ordered_qty: number;
  unit_cost: number | null;
};

type VendorOption = {
  id: string;
  legal_name: string;
};

type LineDraft = {
  id: string;
  variant_id: string;
  ordered_qty: string;
  unit_cost: string;
  variant: VariantSearchResult | null;
};

export default function PurchaseOrderEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineDraft[]>([
    { id: "line-0", variant_id: "", ordered_qty: "", unit_cost: "", variant: null },
  ]);
  const [lineCounter, setLineCounter] = useState(1);

  const canEdit = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "procurement"].includes(ctx.roleKey)),
    [ctx]
  );
  const isDraft = po?.status === "draft";

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

  async function loadData(companyId: string, poId: string, isActiveFetch = true) {
    setError("");
    setNotice("");
    const [vendorRes, poRes, lineRes] = await Promise.all([
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase
        .from("erp_purchase_orders")
        .select("id, doc_no, po_no, vendor_id, status, order_date, expected_delivery_date, notes")
        .eq("company_id", companyId)
        .eq("id", poId)
        .single(),
      supabase
        .from("erp_purchase_order_lines")
        .select("id, variant_id, ordered_qty, unit_cost")
        .eq("company_id", companyId)
        .eq("purchase_order_id", poId)
        .order("created_at", { ascending: true }),
    ]);

    if (vendorRes.error || poRes.error || lineRes.error) {
      if (isActiveFetch) {
        setError(
          vendorRes.error?.message || poRes.error?.message || lineRes.error?.message || "Failed to load purchase order."
        );
      }
      return;
    }

    const lineRows = (lineRes.data || []) as PurchaseOrderLine[];
    const variantIds = lineRows.map((line) => line.variant_id).filter(Boolean);
    const variantRes =
      variantIds.length > 0
        ? await supabase
            .from("erp_variants")
            .select("id, sku, size, color, product_id, erp_products(title, hsn_code, style_code)")
            .eq("company_id", companyId)
            .in("id", variantIds)
        : { data: [], error: null };

    if (variantRes.error) {
      if (isActiveFetch) {
        setError(variantRes.error.message);
      }
      return;
    }

    if (isActiveFetch) {
      const variantMap = new Map(
        (variantRes.data || []).map((row) => [
          row.id,
          {
            variant_id: row.id,
            sku: row.sku,
            size: row.size ?? null,
            color: row.color ?? null,
            product_id: row.product_id,
            style_code: row.erp_products?.[0]?.style_code ?? null,
            title: row.erp_products?.[0]?.title ?? null,
            hsn_code: row.erp_products?.[0]?.hsn_code ?? null,
          } as VariantSearchResult,
        ])
      );

      setPo(poRes.data as PurchaseOrder);
      setVendors((vendorRes.data || []) as VendorOption[]);
      setVendorId(poRes.data?.vendor_id || vendorRes.data?.[0]?.id || "");
      setOrderDate(poRes.data?.order_date || "");
      setExpectedDate(poRes.data?.expected_delivery_date || "");
      setNotes(poRes.data?.notes || "");
      const mappedLines = lineRows.map((line, index) => ({
        id: line.id || `line-${index}`,
        variant_id: line.variant_id,
        ordered_qty: line.ordered_qty?.toString() || "",
        unit_cost: line.unit_cost !== null && line.unit_cost !== undefined ? line.unit_cost.toString() : "",
        variant: variantMap.get(line.variant_id) || null,
      }));
      setLineItems(
        mappedLines.length > 0
          ? mappedLines
          : [{ id: "line-0", variant_id: "", ordered_qty: "", unit_cost: "", variant: null }]
      );
      setLineCounter(mappedLines.length > 0 ? mappedLines.length + 1 : 1);
    }
  }

  function updateLine(lineId: string, next: Partial<LineDraft>) {
    setLineItems((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...next } : line)));
  }

  function addLine() {
    const id = `line-${lineCounter}`;
    setLineCounter((prev) => prev + 1);
    setLineItems((prev) => [...prev, { id, variant_id: "", ordered_qty: "", unit_cost: "", variant: null }]);
  }

  function removeLine(lineId: string) {
    setLineItems((prev) => prev.filter((line) => line.id !== lineId));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId || !po) return;
    if (!canEdit) {
      setError("Only procurement writers/admin can edit draft purchase orders.");
      return;
    }
    if (!isDraft) {
      setError("Only draft purchase orders can be edited.");
      return;
    }
    if (!vendorId) {
      setError("Select a vendor to update this purchase order.");
      return;
    }

    const normalizedLines = lineItems.map((line) => ({
      variant_id: line.variant_id,
      ordered_qty: Number(line.ordered_qty),
      unit_cost: line.unit_cost ? Number(line.unit_cost) : null,
    }));

    const missingVariant = normalizedLines.some(
      (line) => !line.variant_id && Number.isFinite(line.ordered_qty) && line.ordered_qty > 0
    );

    if (missingVariant) {
      setError("Select a SKU for each line item with a quantity.");
      return;
    }

    const validLines = normalizedLines.filter(
      (line) => line.variant_id && Number.isFinite(line.ordered_qty) && line.ordered_qty > 0
    );

    if (validLines.length === 0) {
      setError("Add at least one line with a valid quantity.");
      return;
    }

    setError("");
    setNotice("");
    setSaving(true);

    const { error: updateError } = await supabase
      .from("erp_purchase_orders")
      .update({
        vendor_id: vendorId,
        order_date: orderDate || null,
        expected_delivery_date: expectedDate || null,
        notes: notes.trim() || null,
      })
      .eq("company_id", ctx.companyId)
      .eq("id", po.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("erp_purchase_order_lines")
      .delete()
      .eq("company_id", ctx.companyId)
      .eq("purchase_order_id", po.id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    const { error: lineError } = await supabase.from("erp_purchase_order_lines").insert(
      validLines.map((line) => ({
        company_id: ctx.companyId,
        purchase_order_id: po.id,
        variant_id: line.variant_id,
        ordered_qty: line.ordered_qty,
        unit_cost: line.unit_cost,
      }))
    );

    if (lineError) {
      setError(lineError.message);
      setSaving(false);
      return;
    }

    setNotice("Draft purchase order updated.");
    await loadData(ctx.companyId, po.id);
    setSaving(false);
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>
              Edit Purchase Order {po?.doc_no || "—"}
            </h1>
            <p style={subtitleStyle}>Update the draft purchase order before approval.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={() => router.push(`/erp/inventory/purchase-orders/${id}`)}>
              Back to PO
            </button>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>PO Details</h2>
          {loading ? (
            <p>Loading draft purchase order...</p>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Vendor
                  <select
                    style={inputStyle}
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    disabled={!isDraft || !canEdit || saving}
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
                  Status
                  <input style={inputStyle} value={po?.status || ""} readOnly />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Order Date
                  <input
                    style={inputStyle}
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    disabled={!isDraft || !canEdit || saving}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Expected Delivery
                  <input
                    style={inputStyle}
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    disabled={!isDraft || !canEdit || saving}
                  />
                </label>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                Notes
                <textarea
                  style={{ ...inputStyle, minHeight: 80 }}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!isDraft || !canEdit || saving}
                />
              </label>

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontWeight: 600 }}>Line Items</div>
                {lineItems.map((line, index) => (
                  <div
                    key={line.id}
                    style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      SKU
                      <VariantTypeahead
                        value={line.variant}
                        onSelect={(variant) =>
                          updateLine(line.id, {
                            variant_id: variant?.variant_id || "",
                            variant,
                          })
                        }
                        onError={setError}
                        disabled={!isDraft || !canEdit || saving}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "#4b5563" }}>
                        <span>Style: {line.variant?.style_code || "—"}</span>
                        <span>HSN: {line.variant?.hsn_code || "—"}</span>
                        <span>Item: {line.variant?.title || "—"}</span>
                      </div>
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      Qty
                      <input
                        style={inputStyle}
                        type="number"
                        min="1"
                        value={line.ordered_qty}
                        onChange={(e) => updateLine(line.id, { ordered_qty: e.target.value })}
                        disabled={!isDraft || !canEdit || saving}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      Unit Cost
                      <input
                        style={inputStyle}
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_cost}
                        onChange={(e) => updateLine(line.id, { unit_cost: e.target.value })}
                        disabled={!isDraft || !canEdit || saving}
                      />
                    </label>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() => removeLine(line.id)}
                      disabled={!isDraft || !canEdit || saving || lineItems.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={addLine}
                    disabled={!isDraft || !canEdit || saving}
                  >
                    Add Line
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="submit" style={primaryButtonStyle} disabled={!isDraft || !canEdit || saving}>
                  {saving ? "Saving…" : "Save Draft"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => router.push(`/erp/inventory/purchase-orders/${id}`)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
