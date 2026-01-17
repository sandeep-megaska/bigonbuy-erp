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
  const printParam = Array.isArray(router.query.print) ? router.query.print[0] : router.query.print;
  const isPrintView = printParam === "1";
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
  const branding = useCompanyBranding();

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);
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

  useEffect(() => {
    if (!isPrintView || loading || !po) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isPrintView, loading, po]);

  async function loadData(companyId: string, poId: string, isActiveFetch = true) {
    setError("");
    setNotice("");
    const [poRes, lineRes, vendorRes, variantRes, warehouseRes, grnRes] = await Promise.all([
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, vendor_id, status, order_date, expected_delivery_date, notes")
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
        .select("id, sku, size, color, erp_products(title)")
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

  const subtotal = lines.reduce((sum, line) => {
    if (line.unit_cost === null) return sum;
    return sum + line.unit_cost * line.ordered_qty;
  }, 0);

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const vendorAddressLines = [
    vendor?.address_line1 || vendor?.address || "",
    vendor?.address_line2 || "",
    [vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(", "),
    vendor?.country || "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const termsLines = (branding?.poTermsText || "")
    .split("\n")
    .map((line) => line.replace(/^[•*-]\s*/, "").trim())
    .filter(Boolean);

  const notesLines = (po?.notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const deliveryWarehouse = warehouses[0];

  const printDocument = (
    <div style={printPageStyle}>
      <div style={printHeaderRowStyle}>
        <div style={printBrandBlockStyle}>
          {branding?.bigonbuyLogoUrl ? (
            <img src={branding.bigonbuyLogoUrl} alt="Bigonbuy logo" style={printLogoStyle} />
          ) : (
            <div style={printLogoFallbackStyle}>BIGONBUY</div>
          )}
          <div>
            <div style={printCompanyNameStyle}>{companyLegalName}</div>
            <div style={printCompanySubTextStyle}>GSTIN: {branding?.gstin || "—"}</div>
            <div style={printCompanyAddressStyle}>
              {companyAddressLines.length > 0 ? companyAddressLines.join("\n") : "—"}
            </div>
            <div style={printPoTitleStyle}>Purchase Order</div>
          </div>
        </div>
        <div style={printMetaCardStyle}>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>PO Number</span>
            <span style={printMetaValueStyle}>{po?.po_no || "—"}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>PO Date</span>
            <span style={printMetaValueStyle}>{formatDate(po?.order_date)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Expected Delivery</span>
            <span style={printMetaValueStyle}>{formatDate(po?.expected_delivery_date)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Deliver To</span>
            <span style={printMetaValueStyle}>{deliveryWarehouse?.name || "—"}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Status</span>
            <span style={printMetaValueStyle}>{po?.status || "—"}</span>
          </div>
        </div>
      </div>

      <section style={printSectionStyle}>
        <div style={printSectionTitleStyle}>Vendor</div>
        <div style={printVendorGridStyle}>
          <div>
            <div style={printVendorNameStyle}>{vendor?.legal_name || "—"}</div>
            <div style={printDetailTextStyle}>GSTIN: {vendor?.gstin || "—"}</div>
            <div style={printDetailTextStyle}>
              {vendorAddressLines.length > 0 ? vendorAddressLines.join("\n") : "—"}
            </div>
          </div>
          <div>
            <div style={printDetailLabelStyle}>Contact</div>
            <div style={printDetailTextStyle}>{vendor?.contact_person || "—"}</div>
            <div style={printDetailTextStyle}>Phone: {vendor?.phone || "—"}</div>
            <div style={printDetailTextStyle}>Email: {vendor?.email || "—"}</div>
          </div>
        </div>
      </section>

      <section style={printSectionStyle}>
        <table style={printTableStyle} className="po-print-table">
          <thead>
            <tr>
              <th style={printTableHeaderStyle}>Sl No</th>
              <th style={printTableHeaderStyle}>SKU</th>
              <th style={printTableHeaderStyle}>Item</th>
              <th style={printTableHeaderStyle}>Variant</th>
              <th style={printTableHeaderStyle}>Qty</th>
              <th style={printTableHeaderStyle}>Unit Rate</th>
              <th style={printTableHeaderStyle}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td style={printTableCellStyle} colSpan={7}>
                  No line items found.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => {
                const variant = variantMap.get(line.variant_id);
                const variantLabel = [variant?.color, variant?.size].filter(Boolean).join(" / ") || "—";
                const lineTotal = line.unit_cost !== null ? line.unit_cost * line.ordered_qty : null;
                return (
                  <tr key={line.id}>
                    <td style={printTableCellStyle}>{index + 1}</td>
                    <td style={printTableCellStyle}>{variant?.sku || line.variant_id}</td>
                    <td style={printTableCellStyle}>{variant?.productTitle || "—"}</td>
                    <td style={printTableCellStyle}>{variantLabel}</td>
                    <td style={printTableCellStyle}>{line.ordered_qty}</td>
                    <td style={printTableCellStyle}>{formatMoney(line.unit_cost)}</td>
                    <td style={printTableCellStyle}>{formatMoney(lineTotal)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section style={printTotalsSectionStyle}>
        <div style={printTotalsRowStyle}>
          <span style={printMetaLabelStyle}>Subtotal</span>
          <span style={printTotalsValueStyle}>{formatMoney(subtotal)}</span>
        </div>
        <div style={printTotalsRowStyle}>
          <span style={printMetaLabelStyle}>Tax</span>
          <span style={printTotalsValueStyle}>—</span>
        </div>
        <div style={{ ...printTotalsRowStyle, fontWeight: 700 }}>
          <span>Total Amount ({currencyCode})</span>
          <span style={printTotalsValueStyle}>{formatMoney(subtotal)}</span>
        </div>
      </section>

      {(notesLines.length > 0 || termsLines.length > 0) && (
        <section style={printSectionStyle}>
          {notesLines.length > 0 ? (
            <div style={printNotesBlockStyle}>
              <div style={printSectionTitleStyle}>Notes</div>
              <ul style={printBulletListStyle}>
                {notesLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {termsLines.length > 0 ? (
            <div style={printNotesBlockStyle}>
              <div style={printSectionTitleStyle}>Terms &amp; Conditions</div>
              <ul style={printBulletListStyle}>
                {termsLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      <section style={printSignatureRowStyle}>
        <div style={printSignatureBlockStyle}>
          <div style={printSignatureLineStyle} />
          <div style={printSignatureLabelStyle}>Authorized Signatory</div>
        </div>
        <div style={printSignatureBlockStyle}>
          <div style={printSignatureLineStyle} />
          <div style={printSignatureLabelStyle}>Vendor Acceptance</div>
        </div>
      </section>

      <footer style={printFooterStyle}>
        <div style={printFooterTextStyle}>
          {companyAddressLines.length > 0 ? companyAddressLines.join("\n") : "—"}
        </div>
        <div style={printFooterTextStyle}>GSTIN: {branding?.gstin || "—"}</div>
      </footer>
      <style jsx global>{`
        @media print {
          body {
            background: #fff;
          }

          .po-print-table {
            page-break-inside: auto;
          }

          .po-print-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );

  if (isPrintView) {
    return printDocument;
  }

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
                  window.open(`/erp/inventory/purchase-orders/${po.id}?print=1`, "_blank", "noopener,noreferrer");
                }
              }}
            >
              Print / Save PDF
            </button>
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
                <th style={tableHeaderCellStyle}>Ordered</th>
                <th style={tableHeaderCellStyle}>Received</th>
                <th style={tableHeaderCellStyle}>Remaining</th>
                <th style={tableHeaderCellStyle}>Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
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

const printPageStyle = {
  maxWidth: 980,
  margin: "0 auto",
  padding: "32px 24px",
  backgroundColor: "#ffffff",
  color: "#111827",
  fontFamily: "Inter, system-ui, sans-serif",
};

const printHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  marginBottom: 24,
};

const printBrandBlockStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 16,
  flex: "1 1 320px",
};

const printLogoStyle = {
  height: 48,
  width: "auto",
  objectFit: "contain" as const,
};

const printLogoFallbackStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 48,
  padding: "0 14px",
  borderRadius: 10,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 12,
  letterSpacing: "0.12em",
  fontWeight: 700,
};

const printCompanyNameStyle = {
  fontSize: 20,
  fontWeight: 700,
  color: "#111827",
};

const printCompanySubTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  marginTop: 4,
};

const printCompanyAddressStyle = {
  marginTop: 6,
  fontSize: 12,
  color: "#4b5563",
  whiteSpace: "pre-line" as const,
};

const printPoTitleStyle = {
  marginTop: 10,
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  color: "#6b7280",
  fontWeight: 700,
};

const printMetaCardStyle = {
  minWidth: 240,
  padding: "12px 16px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  backgroundColor: "#f9fafb",
};

const printMetaRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  fontSize: 12,
  padding: "4px 0",
};

const printMetaLabelStyle = {
  color: "#6b7280",
};

const printMetaValueStyle = {
  fontWeight: 600,
  color: "#111827",
};

const printSectionStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "16px 18px",
  marginBottom: 20,
  backgroundColor: "#fff",
};

const printSectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 8,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

const printVendorGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const printVendorNameStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 4,
};

const printDetailLabelStyle = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#9ca3af",
  marginBottom: 6,
};

const printDetailTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  whiteSpace: "pre-line" as const,
};

const printTableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 12,
};

const printTableHeaderStyle = {
  textAlign: "left" as const,
  backgroundColor: "#f3f4f6",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
};

const printTableCellStyle = {
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  verticalAlign: "top" as const,
};

const printTotalsSectionStyle = {
  marginLeft: "auto",
  maxWidth: 320,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 16px",
  backgroundColor: "#f9fafb",
  marginBottom: 20,
};

const printTotalsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  padding: "4px 0",
  fontSize: 13,
};

const printTotalsValueStyle = {
  fontWeight: 600,
};

const printNotesBlockStyle = {
  marginBottom: 12,
};

const printBulletListStyle = {
  margin: "0 0 0 18px",
  padding: 0,
  fontSize: 12,
  color: "#4b5563",
};

const printSignatureRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 24,
  marginBottom: 24,
};

const printSignatureBlockStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};

const printSignatureLineStyle = {
  height: 1,
  backgroundColor: "#111827",
  opacity: 0.3,
  marginTop: 24,
};

const printSignatureLabelStyle = {
  fontSize: 12,
  color: "#4b5563",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

const printFooterStyle = {
  borderTop: "1px solid #e5e7eb",
  paddingTop: 12,
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap" as const,
};

const printFooterTextStyle = {
  fontSize: 11,
  color: "#6b7280",
  whiteSpace: "pre-line" as const,
};
