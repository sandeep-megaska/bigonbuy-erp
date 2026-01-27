import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";
import ErpDocumentHeader from "../../../../../components/erp/ErpDocumentHeader";
import ErpDocumentFooter from "../../../../../components/erp/ErpDocumentFooter";
import { formatInrWords } from "../../../../../lib/erp/inrWords";

type GstRegisterRow = {
  invoice_number: string | null;
  invoice_no: string | null;
  order_number: string | null;
  order_date: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  place_of_supply_code: string | null;
  buyer_state_code: string | null;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  hsn: string | null;
  quantity: number | null;
  gross_before_discount: number | null;
  discount: number | null;
  taxable_value: number | null;
  gst_rate: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_tax: number | null;
  payment_status: string | null;
  payment_gateway: string | null;
  fulfillment_status: string | null;
  source_order_id: string;
  source_line_id: string;
};

type ShopifyOrder = {
  raw_order: Record<string, unknown> | null;
  customer_email: string | null;
  shipping_state_code: string | null;
  shipping_pincode: string | null;
  order_created_at: string | null;
};

type ShopifyOrderLine = {
  id: string;
  sku: string | null;
  quantity: number | null;
  price: number | null;
  line_discount: number | null;
  title: string | null;
};

type CompanyGstProfile = {
  gst_state_code: string | null;
  gst_state_name: string | null;
  gstin: string | null;
};

const pageStyle: React.CSSProperties = {
  background: "#f8fafc",
  minHeight: "100vh",
  padding: "32px 16px",
  display: "flex",
  justifyContent: "center",
};

const sheetStyle: React.CSSProperties = {
  background: "#fff",
  color: "#0f172a",
  maxWidth: 1040,
  width: "100%",
  borderRadius: 16,
  padding: "24px 28px",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)",
};

const warningStyle: React.CSSProperties = {
  background: "#fef3c7",
  border: "1px solid #fcd34d",
  color: "#92400e",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: 12,
  marginTop: 12,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
  marginTop: 18,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 14,
  fontSize: 12,
  background: "#f8fafc",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 20,
  fontSize: 11,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 6px",
  borderBottom: "1px solid #e2e8f0",
  background: "#eef2ff",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#334155",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const totalsWrapStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 0.6fr",
  gap: 16,
  marginTop: 18,
};

const totalsGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const totalCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12,
  background: "#fff",
};

const grandTotalStyle: React.CSSProperties = {
  ...totalCardStyle,
  borderColor: "#1d4ed8",
  background: "#eff6ff",
  fontWeight: 700,
  fontSize: 13,
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 12,
  gap: 12,
  flexWrap: "wrap",
};

const printButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "8px 14px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const mutedTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#334155",
  marginBottom: 8,
};

const amountWordsStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 10,
  background: "#f1f5f9",
  fontSize: 12,
  color: "#0f172a",
  fontWeight: 600,
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN");
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeQueryValue = (value: string | string[] | undefined) => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function GstInvoicePrintPage() {
  const router = useRouter();
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GstRegisterRow[]>([]);
  const [order, setOrder] = useState<ShopifyOrder | null>(null);
  const [orderLines, setOrderLines] = useState<ShopifyOrderLine[]>([]);
  const [companyGst, setCompanyGst] = useState<CompanyGstProfile | null>(null);

  const invoiceKey =
    normalizeQueryValue(router.query.invoice_no) ?? normalizeQueryValue(router.query.invoiceNo) ?? null;

  useEffect(() => {
    if (!invoiceKey) return;
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      await Promise.all([loadInvoice(String(invoiceKey)), loadCompanyProfile()]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [invoiceKey, router]);

  const loadCompanyProfile = async () => {
    const { data, error: companyError } = await supabase.rpc("erp_company_gst_profile");
    if (companyError) {
      return;
    }
    setCompanyGst((data || null) as CompanyGstProfile | null);
  };

  const loadInvoice = async (invoiceLookup: string) => {
    setError(null);
    const { data, error: rowsError } = await supabase
      .from("erp_gst_sales_register")
      .select(
        "invoice_number, invoice_no, order_number, order_date, customer_name, customer_gstin, place_of_supply_code, buyer_state_code, sku, product_title, variant_title, hsn, quantity, gross_before_discount, discount, taxable_value, gst_rate, cgst, sgst, igst, total_tax, payment_status, payment_gateway, fulfillment_status, source_order_id, source_line_id"
      )
      .eq("is_void", false)
      .eq("source", "shopify")
      .or(`invoice_number.eq.${invoiceLookup},invoice_no.eq.${invoiceLookup}`)
      .order("created_at", { ascending: true });

    if (rowsError) {
      setError(rowsError.message || "Failed to load invoice.");
      return;
    }

    const registerRows = (data || []) as GstRegisterRow[];
    if (!registerRows.length) {
      setError("GST invoice not found.");
      return;
    }

    setRows(registerRows);

    const orderId = registerRows[0].source_order_id;
    const { data: orderData, error: orderError } = await supabase
      .from("erp_shopify_orders")
      .select("raw_order, customer_email, shipping_state_code, shipping_pincode, order_created_at")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      setError(orderError.message || "Failed to load order data.");
      return;
    }

    setOrder((orderData || null) as ShopifyOrder | null);

    const { data: lineData, error: lineError } = await supabase
      .from("erp_shopify_order_lines")
      .select("id, sku, quantity, price, line_discount, title")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (lineError) {
      setError(lineError.message || "Failed to load order lines.");
      return;
    }

    setOrderLines((lineData || []) as ShopifyOrderLine[]);
  };

  const invoiceHeader = rows[0];
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const taxable = round2(row.taxable_value ?? 0);
        const cgst = round2(row.cgst ?? 0);
        const sgst = round2(row.sgst ?? 0);
        const igst = round2(row.igst ?? 0);
        return {
          taxable: acc.taxable + taxable,
          cgst: acc.cgst + cgst,
          sgst: acc.sgst + sgst,
          igst: acc.igst + igst,
          total: acc.total + taxable + cgst + sgst + igst,
        };
      },
      { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
    );
  }, [rows]);

  const orderLineMap = useMemo(
    () => new Map(orderLines.map((line) => [line.id, line])),
    [orderLines]
  );

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rawOrder = order?.raw_order as Record<string, any> | null;
  const billingAddress = rawOrder?.billing_address || {};
  const shippingAddress = rawOrder?.shipping_address || billingAddress;

  const formatAddress = (address: Record<string, any>) =>
    [address?.name, address?.address1, address?.address2, address?.city, address?.province, address?.zip, address?.country]
      .filter(Boolean)
      .map((line: string) => String(line));

  const billingAddressLines = formatAddress(billingAddress);
  const shippingAddressLines = formatAddress(shippingAddress);

  const customerState =
    invoiceHeader?.buyer_state_code || order?.shipping_state_code || shippingAddress?.province || billingAddress?.province;

  const placeOfSupplyCode = invoiceHeader?.place_of_supply_code || invoiceHeader?.buyer_state_code || customerState || "";
  const placeOfSupplyName = shippingAddress?.province || billingAddress?.province || placeOfSupplyCode || "";
  const placeOfSupplyLabel = placeOfSupplyName
    ? `${placeOfSupplyName}${placeOfSupplyCode ? ` (${placeOfSupplyCode})` : ""}`
    : "—";

  const supplierStateLabel = companyGst?.gst_state_name
    ? `${companyGst.gst_state_name} (${companyGst.gst_state_code || "—"})`
    : companyGst?.gst_state_code || "—";

  const invoiceNumber = invoiceHeader?.invoice_number || invoiceHeader?.invoice_no || "";
  const invoiceNumberMissing = !invoiceHeader?.invoice_number && !invoiceHeader?.invoice_no;
  const paymentGateways = Array.isArray(rawOrder?.payment_gateway_names)
    ? (rawOrder?.payment_gateway_names as string[]).filter(Boolean)
    : [];
  const paymentGatewayLabel = paymentGateways.join(", ") || invoiceHeader?.payment_gateway || "";
  const paymentStatusSource =
    typeof rawOrder?.financial_status === "string" ? rawOrder.financial_status : invoiceHeader?.payment_status || "";
  const paymentStatusLabel = paymentStatusSource ? paymentStatusSource.toLowerCase() : "";
  const rawGateway =
    typeof rawOrder?.gateway === "string"
      ? rawOrder.gateway
      : typeof rawOrder?.gateway_name === "string"
        ? rawOrder.gateway_name
        : "";
  const rawPaymentTerms =
    typeof rawOrder?.payment_terms?.payment_terms_name === "string"
      ? rawOrder.payment_terms.payment_terms_name
      : "";
  const fallbackGateway = paymentGatewayLabel || rawGateway || rawPaymentTerms;
  const paymentMethod =
    paymentStatusLabel === "paid"
      ? "Paid (Razorpay)"
      : paymentStatusLabel === "pending"
        ? "Cash On Delivery"
        : fallbackGateway
          ? toTitleCase(fallbackGateway)
          : "—";
  const qrCodeUrl = useMemo(() => {
    const orderNumber = invoiceHeader?.order_number || "";
    const total = round2(totals.total);
    if (!invoiceNumber && !orderNumber) return null;
    const payload = `Invoice:${invoiceNumber || "NA"}|Order:${orderNumber || "NA"}|Total:${total}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(payload)}`;
  }, [invoiceHeader?.order_number, invoiceNumber, totals.total]);

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: branding?.currencyCode || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(value));

  if (loading) {
    return <div style={pageStyle}>Loading GST invoice…</div>;
  }

  return (
    <div style={pageStyle} className="gst-invoice-print">
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 12mm 14mm;
          }

          body {
            background: #fff !important;
            margin: 0;
          }

          .gst-invoice-print {
            padding: 0 !important;
            background: #fff !important;
          }

          .gst-print-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            max-width: none !important;
          }

          .gst-lines-table thead {
            display: table-header-group;
          }

          .gst-lines-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .no-print {
            display: none !important;
          }
        }
      `}</style>
      <div style={sheetStyle} className="gst-print-sheet">
        {error ? (
          <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>
        ) : (
          <>
            <header>
              <ErpDocumentHeader
                title="Tax Invoice"
                tag="Original"
                subtitle="GST-compliant invoice"
                gstin={companyGst?.gstin || branding?.gstin || "—"}
                stateLabel={supplierStateLabel}
                contactEmail={branding?.contactEmail}
                contactWebsite={branding?.website}
                contactPhone={branding?.contactPhone}
                qrCodeUrl={qrCodeUrl}
              />
              <div style={buttonRowStyle} className="no-print">
                <span style={mutedTextStyle}>Invoice #{invoiceNumber || "—"}</span>
                <button type="button" style={printButtonStyle} onClick={() => window.print()}>
                  Print
                </button>
              </div>
              {invoiceNumberMissing ? <div style={warningStyle}>Invoice number missing</div> : null}
            </header>

            <section style={gridStyle}>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Invoice Details</div>
                <div>Invoice No: {invoiceNumber || "—"}</div>
                <div>Order Id: {invoiceHeader?.order_number || "—"}</div>
                <div>Invoice Date: {formatDate(invoiceHeader?.order_date || order?.order_created_at || null)}</div>
                <div>Payment Status: {paymentStatusLabel || "—"}</div>
                <div>Payment Method: {paymentMethod}</div>
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Place of Supply</div>
                <div style={{ fontWeight: 700 }}>{placeOfSupplyLabel}</div>
                <div style={mutedTextStyle}>State Code: {placeOfSupplyCode || "—"}</div>
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Order Status</div>
                <div>Payment Status: {paymentStatusLabel || "—"}</div>
                <div>Fulfillment: {invoiceHeader?.fulfillment_status || "—"}</div>
              </div>
            </section>

            <section style={gridStyle}>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Billed To</div>
                <div style={{ fontWeight: 700 }}>{invoiceHeader?.customer_name || order?.customer_email || "—"}</div>
                <div>GSTIN: {invoiceHeader?.customer_gstin || "—"}</div>
                <div>State: {customerState || "—"}</div>
                {billingAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Ship To</div>
                <div style={{ fontWeight: 700 }}>{shippingAddress?.name || invoiceHeader?.customer_name || "—"}</div>
                <div>State: {customerState || "—"}</div>
                {shippingAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Sold By</div>
                <div style={{ fontWeight: 700 }}>{companyLegalName}</div>
                <div>GSTIN: {companyGst?.gstin || branding?.gstin || "—"}</div>
                <div>State: {supplierStateLabel}</div>
                {companyAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </section>

            <table style={tableStyle} className="gst-lines-table">
              <thead>
                <tr>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Rate/MRP</th>
                  <th style={thStyle}>Discount</th>
                  <th style={thStyle}>Taxable</th>
                  <th style={thStyle}>HSN</th>
                  <th style={thStyle}>GST %</th>
                  <th style={thStyle}>IGST</th>
                  <th style={thStyle}>CGST</th>
                  <th style={thStyle}>SGST</th>
                  <th style={thStyle}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const lineData = orderLineMap.get(row.source_line_id);
                  const taxable = round2(row.taxable_value ?? 0);
                  const igst = round2(row.igst ?? 0);
                  const cgst = round2(row.cgst ?? 0);
                  const sgst = round2(row.sgst ?? 0);
                  const total = round2(taxable + cgst + sgst + igst);
                  const qty = row.quantity ?? lineData?.quantity ?? 0;
                  const rateFromOrder = lineData?.price ?? null;
                  const grossFromRegister = row.gross_before_discount ?? null;
                  const gross =
                    grossFromRegister != null
                      ? round2(grossFromRegister)
                      : rateFromOrder != null
                      ? round2(rateFromOrder * qty)
                      : null;
                  const discountFromOrder = lineData?.line_discount ?? null;
                  const discountFromRegister = row.discount ?? null;
                  const discount =
                    discountFromRegister != null
                      ? round2(discountFromRegister)
                      : discountFromOrder != null
                      ? round2(discountFromOrder)
                      : Math.max(0, round2((gross ?? 0) - taxable));
                  const effectiveGross = gross != null ? gross : round2(taxable + discount);
                  const rate = qty ? round2(effectiveGross / qty) : 0;
                  const fullTitle = row.product_title || lineData?.title || row.hsn || "—";
                  return (
                    <tr key={`${row.hsn}-${index}`}>
                      <td style={{ ...tdStyle, whiteSpace: "normal", wordBreak: "break-word" }} title={fullTitle}>
                        {fullTitle}
                      </td>
                      <td style={tdStyle}>{row.sku || lineData?.sku || "—"}</td>
                      <td style={tdStyle}>{qty}</td>
                      <td style={tdStyle}>{rate ? formatMoney(rate) : "—"}</td>
                      <td style={tdStyle}>{discount ? formatMoney(discount) : "—"}</td>
                      <td style={tdStyle}>{formatMoney(taxable)}</td>
                      <td style={tdStyle}>{row.hsn || "—"}</td>
                      <td style={tdStyle}>{row.gst_rate != null ? `${row.gst_rate}%` : "—"}</td>
                      <td style={tdStyle}>{formatMoney(igst)}</td>
                      <td style={tdStyle}>{formatMoney(cgst)}</td>
                      <td style={tdStyle}>{formatMoney(sgst)}</td>
                      <td style={tdStyle}>{formatMoney(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <section style={totalsWrapStyle}>
              <div>
                <div style={sectionTitleStyle}>Amount in Words</div>
                <div style={amountWordsStyle}>{formatInrWords(totals.total)}</div>
                <div style={{ ...sectionTitleStyle, marginTop: 16 }}>Payment Summary</div>
                <div style={cardStyle}>
                  <div>Payment Status: {paymentStatusLabel || "—"}</div>
                  <div>Payment Method: {paymentMethod}</div>
                  <div>Fulfillment: {invoiceHeader?.fulfillment_status || "—"}</div>
                </div>
              </div>
              <div>
                <div style={sectionTitleStyle}>Totals</div>
                <div style={totalsGridStyle}>
                  <div style={totalCardStyle}>
                    <span>Total taxable</span>
                    <span>{formatMoney(totals.taxable)}</span>
                  </div>
                  <div style={totalCardStyle}>
                    <span>Total IGST</span>
                    <span>{formatMoney(totals.igst)}</span>
                  </div>
                  <div style={totalCardStyle}>
                    <span>Total CGST</span>
                    <span>{formatMoney(totals.cgst)}</span>
                  </div>
                  <div style={totalCardStyle}>
                    <span>Total SGST</span>
                    <span>{formatMoney(totals.sgst)}</span>
                  </div>
                  <div style={grandTotalStyle}>
                    <span>Grand Total</span>
                    <span>{formatMoney(totals.total)}</span>
                  </div>
                </div>
              </div>
            </section>

            <ErpDocumentFooter
              addressLines={companyAddressLines}
              gstin={companyGst?.gstin || branding?.gstin || "—"}
              note="This is a computer generated invoice and hence no signature is required."
            />
          </>
        )}
      </div>
    </div>
  );
}
