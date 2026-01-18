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
import VariantTypeahead, { type VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type VendorOption = {
  id: string;
  legal_name: string;
};

type PurchaseOrder = {
  id: string;
  po_no: string;
  vendor_id: string;
  status: string;
  order_date: string;
  expected_delivery_date: string | null;
  created_at: string;
};

type PurchaseOrderLine = {
  purchase_order_id: string;
  ordered_qty: number;
  received_qty: number;
};

type LineDraft = {
  variant_id: string;
  ordered_qty: string;
  unit_cost: string;
  variant: VariantSearchResult | null;
};

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);

  const [vendorId, setVendorId] = useState("");
  const [status, setStatus] = useState("draft");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineDraft[]>([
    { variant_id: "", ordered_qty: "", unit_cost: "", variant: null },
  ]);

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
    const [vendorRes, orderRes, lineRes] = await Promise.all([
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, vendor_id, status, order_date, expected_delivery_date, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("erp_purchase_order_lines")
        .select("purchase_order_id, ordered_qty, received_qty")
        .eq("company_id", companyId),
    ]);

    if (vendorRes.error || orderRes.error || lineRes.error) {
      if (isActiveFetch) {
        setError(
          vendorRes.error?.message ||
            orderRes.error?.message ||
            lineRes.error?.message ||
            "Failed to load purchase orders."
        );
      }
      return;
    }

    if (isActiveFetch) {
      setVendors((vendorRes.data || []) as VendorOption[]);
      setOrders((orderRes.data || []) as PurchaseOrder[]);
      setLines((lineRes.data || []) as PurchaseOrderLine[]);
      setVendorId(vendorRes.data?.[0]?.id || "");
    }
  }

  function updateLine(index: number, next: Partial<LineDraft>) {
    setLineItems((prev) => prev.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function addLine() {
    setLineItems((prev) => [...prev, { variant_id: "", ordered_qty: "", unit_cost: "", variant: null }]);
  }

  function removeLine(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setStatus("draft");
    setOrderDate("");
    setExpectedDate("");
    setNotes("");
    setLineItems([{ variant_id: "", ordered_qty: "", unit_cost: "", variant: null }]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can create purchase orders.");
      return;
    }
    if (!vendorId) {
      setError("Select a vendor to create a purchase order.");
      return;
    }

    const normalizedLines = lineItems
      .map((line) => ({
        variant_id: line.variant_id,
        ordered_qty: Number(line.ordered_qty),
        unit_cost: line.unit_cost ? Number(line.unit_cost) : null,
      }))
      .filter((line) => line.variant_id && Number.isFinite(line.ordered_qty) && line.ordered_qty > 0);

    if (normalizedLines.length === 0) {
      setError("Add at least one line with a valid quantity.");
      return;
    }

    setError("");
    const { data: po, error: poError } = await supabase
      .from("erp_purchase_orders")
      .insert({
        company_id: ctx.companyId,
        vendor_id: vendorId,
        status,
        order_date: orderDate || null,
        expected_delivery_date: expectedDate || null,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (poError) {
      setError(poError.message);
      return;
    }

    const { error: lineError } = await supabase.from("erp_purchase_order_lines").insert(
      normalizedLines.map((line) => ({
        company_id: ctx.companyId,
        purchase_order_id: po.id,
        variant_id: line.variant_id,
        ordered_qty: line.ordered_qty,
        unit_cost: line.unit_cost,
      }))
    );

    if (lineError) {
      setError(lineError.message);
      return;
    }

    resetForm();
    await loadData(ctx.companyId);
  }

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.legal_name])), [vendors]);
  const lineSummary = useMemo(() => {
    const summary = new Map<string, { ordered: number; received: number }>();
    lines.forEach((line) => {
      const current = summary.get(line.purchase_order_id) || { ordered: 0, received: 0 };
      summary.set(line.purchase_order_id, {
        ordered: current.ordered + (line.ordered_qty || 0),
        received: current.received + (line.received_qty || 0),
      });
    });
    return summary;
  }, [lines]);

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>Purchase Orders</h1>
            <p style={subtitleStyle}>Create POs and track receipts.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Create Purchase Order</h2>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                Vendor
                <select style={inputStyle} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
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
                <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Order Date
                <input style={inputStyle} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Expected Delivery
                <input
                  style={inputStyle}
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </label>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              Notes
              <textarea style={{ ...inputStyle, minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>Line Items</div>
              {lineItems.map((line, index) => (
                <div
                  key={`line-${index}`}
                  style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}
                >
                  <label style={{ display: "grid", gap: 6 }}>
                    SKU
                    <VariantTypeahead
                      valueVariantId={line.variant_id}
                      valueVariant={line.variant}
                      onSelect={(variant) =>
                        updateLine(index, {
                          variant_id: variant?.variant_id || "",
                          variant,
                        })
                      }
                      onError={setError}
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
                      onChange={(e) => updateLine(index, { ordered_qty: e.target.value })}
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
                      onChange={(e) => updateLine(index, { unit_cost: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => removeLine(index)}
                    disabled={lineItems.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div>
                <button type="button" style={secondaryButtonStyle} onClick={addLine}>
                  Add Line
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite}>
                Create PO
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
                Reset
              </button>
            </div>
          </form>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>PO</th>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Dates</th>
                <th style={tableHeaderCellStyle}>Qty</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    Loading purchase orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No purchase orders yet.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const summary = lineSummary.get(order.id) || { ordered: 0, received: 0 };
                  return (
                    <tr key={order.id}>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600 }}>{order.po_no}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{order.order_date}</div>
                      </td>
                      <td style={tableCellStyle}>{vendorMap.get(order.vendor_id) || order.vendor_id}</td>
                      <td style={tableCellStyle}>
                        <div>Order: {order.order_date}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>
                          Expected: {order.expected_delivery_date || "—"}
                        </div>
                      </td>
                      <td style={tableCellStyle}>
                        {summary.received}/{summary.ordered}
                      </td>
                      <td style={tableCellStyle}>{order.status}</td>
                      <td style={tableCellStyle}>
                        <Link href={`/erp/inventory/purchase-orders/${order.id}`} style={secondaryButtonStyle}>
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
