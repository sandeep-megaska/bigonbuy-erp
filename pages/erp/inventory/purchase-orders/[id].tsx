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
import { useCompanyBranding } from "../../../../lib/erp/useCompanyBranding";

type PurchaseOrder = {
  id: string;
  po_no: string;
  vendor_id: string;
  status: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  deliver_to_warehouse_id: string | null;
};

type Vendor = {
  id: string;
  legal_name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
};

type PurchaseOrderLine = {
  id: string;
  variant_id: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number | null;
};

type VariantOption = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
  hsnCode: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type Grn = {
  id: string;
  grn_no: string;
  status: string;
  received_at: string;
};

type ReceiptLineDraft = {
  lineId: string;
  variantId: string;
  remainingQty: number;
  receiveQty: string;
  warehouseId: string;
  unitCost: number | null;
};

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [receiptLines, setReceiptLines] = useState<ReceiptLineDraft[]>([]);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [actionState, setActionState] = useState<"draft" | "post" | null>(null);
  const [approveState, setApproveState] = useState<"idle" | "saving">("idle");
  const branding = useCompanyBranding();

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);
  const canApprove = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "procurement"].includes(ctx.roleKey)),
    [ctx]
  );
  const currencyCode = branding?.currencyCode || "INR";

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
    const [poRes, lineRes, vendorRes, variantRes, warehouseRes, grnRes] = await Promise.all([
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, vendor_id, status, order_date, expected_delivery_date, notes, deliver_to_warehouse_id")
        .eq("company_id", companyId)
        .eq("id", poId)
        .single(),
      supabase
        .from("erp_purchase_order_lines")
        .select("id, variant_id, ordered_qty, received_qty, unit_cost")
        .eq("company_id", companyId)
        .eq("purchase_order_id", poId)
        .order("created_at", { ascending: true }),
      supabase
        .from("erp_vendors")
        .select(
          "id, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country"
        )
        .eq("company_id", companyId),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title, hsn_code)")
        .eq("company_id", companyId)
        .order("sku"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
      supabase
        .from("erp_grns")
        .select("id, grn_no, status, received_at")
        .eq("company_id", companyId)
        .eq("purchase_order_id", poId)
        .order("received_at", { ascending: false }),
    ]);

    if (
      poRes.error ||
      lineRes.error ||
      vendorRes.error ||
      variantRes.error ||
      warehouseRes.error ||
      grnRes.error
    ) {
      if (isActiveFetch) {
        setError(
          poRes.error?.message ||
            lineRes.error?.message ||
            vendorRes.error?.message ||
            variantRes.error?.message ||
            warehouseRes.error?.message ||
            grnRes.error?.message ||
            "Failed to load purchase order."
        );
      }
      return;
    }

    if (isActiveFetch) {
      setPo(poRes.data as PurchaseOrder);
      const vendorList = (vendorRes.data || []) as Vendor[];
      setVendor(vendorList.find((row) => row.id === poRes.data?.vendor_id) || null);
      setLines((lineRes.data || []) as PurchaseOrderLine[]);
      const variantRows = (variantRes.data || []) as Array<{
        id: string;
        sku: string;
        size: string | null;
        color: string | null;
        erp_products?: { title?: string | null; hsn_code?: string | null } | null;
      }>;
      setVariants(
        variantRows.map((row) => ({
          id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          productTitle: row.erp_products?.title || "",
          hsnCode: row.erp_products?.hsn_code ?? null,
        }))
      );
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setGrns((grnRes.data || []) as Grn[]);

      const firstWarehouse = warehouseRes.data?.[0]?.id || "";
      const drafts =
        (lineRes.data || []).map((line) => ({
          lineId: line.id,
          variantId: line.variant_id,
          remainingQty: Math.max(0, (line.ordered_qty || 0) - (line.received_qty || 0)),
          receiveQty: "",
          warehouseId: firstWarehouse,
          unitCost: line.unit_cost ?? null,
        })) || [];
      setReceiptLines(drafts);
    }
  }

  function updateReceiptLine(index: number, next: Partial<ReceiptLineDraft>) {
    setReceiptLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function buildReceiptLines() {
    return receiptLines
      .map((line) => ({
        ...line,
        receiveQtyNum: Number(line.receiveQty),
      }))
      .filter((line) => Number.isFinite(line.receiveQtyNum) && line.receiveQtyNum > 0);
  }

  function validateReceiptLines(linesToReceive: Array<ReceiptLineDraft & { receiveQtyNum: number }>) {
    if (linesToReceive.length === 0) {
      return "Enter at least one received quantity.";
    }

    for (const line of linesToReceive) {
      if (!line.warehouseId) {
        return "Select a warehouse for every received line.";
      }
      if (line.receiveQtyNum > line.remainingQty) {
        return "Received quantities cannot exceed remaining quantities.";
      }
    }

    return "";
  }

  async function createDraftGrn(linesToReceive: Array<ReceiptLineDraft & { receiveQtyNum: number }>) {
    if (!ctx?.companyId || !po) {
      throw new Error("Purchase order context is missing.");
    }

    const { data: grn, error: grnError } = await supabase
      .from("erp_grns")
      .insert({
        company_id: ctx.companyId,
        purchase_order_id: po.id,
        notes: receiptNotes.trim() || null,
      })
      .select("id, grn_no")
      .single();

    if (grnError) {
      throw new Error(grnError.message);
    }

    const { error: lineError } = await supabase.from("erp_grn_lines").insert(
      linesToReceive.map((line) => ({
        company_id: ctx.companyId,
        grn_id: grn.id,
        purchase_order_line_id: line.lineId,
        variant_id: line.variantId,
        warehouse_id: line.warehouseId,
        received_qty: line.receiveQtyNum,
        unit_cost: line.unitCost,
      }))
    );

    if (lineError) {
      throw new Error(lineError.message);
    }

    return grn;
  }

  async function handleSaveDraft() {
    if (!ctx?.companyId || !po) return;
    if (!canWrite) {
      setError("Only owner/admin can post GRNs.");
      return;
    }

    const linesToReceive = buildReceiptLines();
    const validationError = validateReceiptLines(linesToReceive);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setNotice("");
    setActionState("draft");

    try {
      const grn = await createDraftGrn(linesToReceive);
      setNotice(`Draft GRN ${grn.grn_no} saved.`);
      setReceiptNotes("");
      await loadData(ctx.companyId, po.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft GRN.");
    } finally {
      setActionState(null);
    }
  }

  async function handlePostGrn(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId || !po) return;
    if (!canWrite) {
      setError("Only owner/admin can post GRNs.");
      return;
    }

    const linesToReceive = buildReceiptLines();
    const validationError = validateReceiptLines(linesToReceive);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setNotice("");
    setActionState("post");

    try {
      const grn = await createDraftGrn(linesToReceive);
      const { error: postError } = await supabase.rpc("erp_post_grn", { p_grn_id: grn.id });
      if (postError) {
        throw new Error(postError.message);
      }

      setNotice("GRN posted and inventory updated.");
      setReceiptNotes("");
      await loadData(ctx.companyId, po.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post GRN.");
    } finally {
      setActionState(null);
    }
  }

  async function handleApproveDraft() {
    if (!ctx?.companyId || !po) return;
    if (!canApprove) {
      setError("Only procurement writers/admin can approve purchase orders.");
      return;
    }

    const confirmed = typeof window === "undefined" ? false : window.confirm("Approve this purchase order?");
    if (!confirmed) return;

    setError("");
    setNotice("");
    setApproveState("saving");

    try {
      const { error: approveError } = await supabase.rpc("erp_proc_po_approve", { p_po_id: po.id });
      if (approveError) {
        throw new Error(approveError.message);
      }
      setNotice("Purchase order approved.");
      await loadData(ctx.companyId, po.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve purchase order.");
    } finally {
      setApproveState("idle");
    }
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString();
  };

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>Purchase Order {po?.po_no || ""}</h1>
            <p style={subtitleStyle}>Review PO details and receive goods.</p>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => {
                if (typeof window !== "undefined" && po?.id) {
                  window.open(`/erp/inventory/purchase-orders/${po.id}/print`, "_blank");
                }
              }}
            >
              Print / Save PDF
            </button>
            {po?.status === "draft" ? (
              <>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => router.push(`/erp/inventory/purchase-orders/${po.id}/edit`)}
                  disabled={!canApprove || approveState !== "idle"}
                >
                  Edit Draft
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handleApproveDraft}
                  disabled={!canApprove || approveState !== "idle"}
                >
                  {approveState === "saving" ? "Approving…" : "Approve PO"}
                </button>
              </>
            ) : null}
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>PO Summary</h2>
          {loading ? (
            <p>Loading purchase order...</p>
          ) : po ? (
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Vendor</div>
                <div style={{ fontWeight: 600 }}>{vendor?.legal_name || po.vendor_id}</div>
                <div style={{ color: "#6b7280", fontSize: 12 }}>
                  {vendor?.contact_person || ""} {vendor?.phone || vendor?.email || ""}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Status</div>
                <div style={{ fontWeight: 600 }}>{po.status}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Order Date</div>
                <div style={{ fontWeight: 600 }}>{formatDate(po.order_date)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Expected Delivery</div>
                <div style={{ fontWeight: 600 }}>{formatDate(po.expected_delivery_date)}</div>
              </div>
            </div>
          ) : (
            <p>Purchase order not found.</p>
          )}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>PO Lines</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>HSN</th>
                <th style={tableHeaderCellStyle}>Ordered</th>
                <th style={tableHeaderCellStyle}>Received</th>
                <th style={tableHeaderCellStyle}>Remaining</th>
                <th style={tableHeaderCellStyle}>Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No line items found.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const remaining = Math.max(0, line.ordered_qty - line.received_qty);
                  const variant = variantMap.get(line.variant_id);
                  return (
                    <tr key={line.id}>
                      <td style={tableCellStyle}>{variant?.sku || line.variant_id}</td>
                      <td style={tableCellStyle}>{variant?.hsnCode || "—"}</td>
                      <td style={tableCellStyle}>{line.ordered_qty}</td>
                      <td style={tableCellStyle}>{line.received_qty}</td>
                      <td style={tableCellStyle}>{remaining}</td>
                      <td style={tableCellStyle}>{formatMoney(line.unit_cost)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Receive Goods (Create &amp; Post GRN)</h2>
          <form onSubmit={handlePostGrn} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12 }}>
              {receiptLines.map((line, index) => (
                <div
                  key={line.lineId}
                  style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr 1fr", alignItems: "end" }}
                >
                  <div style={{ fontWeight: 600 }}>{variantMap.get(line.variantId)?.sku || line.variantId}</div>
                  <label style={{ display: "grid", gap: 6 }}>
                    Remaining
                    <input style={inputStyle} value={line.remainingQty} readOnly />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    Receive Qty
                    <input
                      style={inputStyle}
                      type="number"
                      min="0"
                      max={line.remainingQty}
                      value={line.receiveQty}
                      onChange={(e) => updateReceiptLine(index, { receiveQty: e.target.value })}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    Warehouse
                    <select
                      style={inputStyle}
                      value={line.warehouseId}
                      onChange={(e) => updateReceiptLine(index, { warehouseId: e.target.value })}
                    >
                      <option value="">Select</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              Receipt Notes
              <textarea
                style={{ ...inputStyle, minHeight: 80 }}
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
              />
            </label>

            <div className="no-print" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={handleSaveDraft}
                disabled={!canWrite || actionState !== null}
              >
                {actionState === "draft" ? "Saving…" : "Save Draft GRN"}
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite || actionState !== null}>
                {actionState === "post" ? "Posting…" : "Post GRN"}
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => router.push("/erp/inventory/purchase-orders")}
              >
                Back to POs
              </button>
            </div>
          </form>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>GRN History</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>GRN</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Received At</th>
              </tr>
            </thead>
            <tbody>
              {grns.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={3}>
                    No GRNs posted yet.
                  </td>
                </tr>
              ) : (
                grns.map((grn) => (
                  <tr key={grn.id}>
                    <td style={tableCellStyle}>{grn.grn_no}</td>
                    <td style={tableCellStyle}>{grn.status}</td>
                    <td style={tableCellStyle}>{new Date(grn.received_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
