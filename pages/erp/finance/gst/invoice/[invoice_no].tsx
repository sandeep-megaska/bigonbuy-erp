import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";

type GstRegisterRow = {
  invoice_number: string | null;
  invoice_no: string | null;
  order_number: string | null;
  order_date: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  place_of_supply_code: string | null;
  buyer_state_code: string | null;
  product_title: string | null;
  variant_title: string | null;
  hsn: string | null;
  quantity: number | null;
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
};

type ShopifyOrder = {
  raw_order: Record<string, unknown> | null;
  customer_email: string | null;
  shipping_state_code: string | null;
  shipping_pincode: string | null;
  order_created_at: string | null;
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
  maxWidth: 980,
  width: "100%",
  borderRadius: 12,
  padding: "24px 32px",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)",
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const subHeadingStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "#475569",
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
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginTop: 16,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 12,
  fontSize: 13,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 20,
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const totalsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
  marginTop: 16,
};

const totalCardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 12,
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

export default function GstInvoicePrintPage() {
  const router = useRouter();
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GstRegisterRow[]>([]);
  const [order, setOrder] = useState<ShopifyOrder | null>(null);
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
        "invoice_number, invoice_no, order_number, order_date, customer_name, customer_gstin, place_of_supply_code, buyer_state_code, product_title, variant_title, hsn, quantity, taxable_value, gst_rate, cgst, sgst, igst, total_tax, payment_status, payment_gateway, fulfillment_status, source_order_id"
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

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const customerAddress = (() => {
    const rawOrder = order?.raw_order as Record<string, any> | null;
    const shipping = rawOrder?.shipping_address || rawOrder?.billing_address || {};
    const addressLines = [
      shipping?.address1,
      shipping?.address2,
      shipping?.city,
      shipping?.province,
      shipping?.zip,
      shipping?.country,
    ].filter(Boolean);
    return addressLines.map((line: string) => String(line));
  })();

  const customerState =
    invoiceHeader?.buyer_state_code || order?.shipping_state_code || (order?.raw_order as any)?.shipping_address?.province;

  const invoiceNumber = invoiceHeader?.invoice_number || invoiceHeader?.invoice_no || "";
  const invoiceNumberMissing = !invoiceHeader?.invoice_number;

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
              <div style={headerRowStyle}>
                <div>
                  <h1 style={headingStyle}>Tax Invoice</h1>
                  <p style={subHeadingStyle}>GST invoice for Shopify order</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 600 }}>{companyLegalName}</div>
                  <div style={mutedTextStyle}>GSTIN: {companyGst?.gstin || branding?.gstin || "—"}</div>
                  <div style={mutedTextStyle}>
                    State: {companyGst?.gst_state_name || "—"} ({companyGst?.gst_state_code || "—"})
                  </div>
                  {companyAddressLines.map((line) => (
                    <div key={line} style={mutedTextStyle}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
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
                <div style={{ fontWeight: 600 }}>Company</div>
                <div>{companyLegalName}</div>
                <div>GSTIN: {companyGst?.gstin || branding?.gstin || "—"}</div>
                <div>
                  State: {companyGst?.gst_state_name || "—"} ({companyGst?.gst_state_code || "—"})
                </div>
                {companyAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600 }}>Invoice Details</div>
                <div>Invoice No: {invoiceNumber || "—"}</div>
                <div>Invoice Date: {formatDate(invoiceHeader?.order_date || order?.order_created_at || null)}</div>
                <div>Order No: {invoiceHeader?.order_number || "—"}</div>
                <div>
                  Place of Supply: {invoiceHeader?.place_of_supply_code || invoiceHeader?.buyer_state_code || "—"}
                </div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600 }}>Customer</div>
                <div>{invoiceHeader?.customer_name || order?.customer_email || "—"}</div>
                <div>GSTIN: {invoiceHeader?.customer_gstin || "—"}</div>
                <div>State: {customerState || "—"}</div>
                {customerAddress.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </section>

            <table style={tableStyle} className="gst-lines-table">
              <thead>
                <tr>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>Variant</th>
                  <th style={thStyle}>HSN</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Taxable Value</th>
                  <th style={thStyle}>GST %</th>
                  <th style={thStyle}>IGST</th>
                  <th style={thStyle}>CGST</th>
                  <th style={thStyle}>SGST</th>
                  <th style={thStyle}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const taxable = round2(row.taxable_value ?? 0);
                  const igst = round2(row.igst ?? 0);
                  const cgst = round2(row.cgst ?? 0);
                  const sgst = round2(row.sgst ?? 0);
                  const total = round2(taxable + cgst + sgst + igst);
                  return (
                    <tr key={`${row.hsn}-${index}`}>
                      <td style={tdStyle}>{row.product_title || row.hsn || "—"}</td>
                      <td style={tdStyle}>{row.variant_title || "—"}</td>
                      <td style={tdStyle}>{row.hsn || "—"}</td>
                      <td style={tdStyle}>{row.quantity ?? 0}</td>
                      <td style={tdStyle}>{formatMoney(taxable)}</td>
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

            <section style={totalsGridStyle}>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Total taxable</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.taxable)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Total IGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.igst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Total CGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.cgst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Total SGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.sgst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Grand total</div>
                <div style={{ fontWeight: 700 }}>{formatMoney(totals.total)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Payment status</div>
                <div style={{ fontWeight: 600 }}>{invoiceHeader?.payment_status || "—"}</div>
                <div style={mutedTextStyle}>Gateway: {invoiceHeader?.payment_gateway || "—"}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Fulfillment status</div>
                <div style={{ fontWeight: 600 }}>{invoiceHeader?.fulfillment_status || "—"}</div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
