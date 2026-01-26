import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";

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

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
};

const subHeadingStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 14,
  color: "#475569",
};

const metaGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  marginTop: 16,
};

const metaCardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 12,
  fontSize: 13,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 20,
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 12,
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
  marginTop: 16,
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

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN");
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function GstInvoicePrintPage() {
  const router = useRouter();
  const { invoiceNo } = router.query;
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GstRegisterRow[]>([]);
  const [order, setOrder] = useState<ShopifyOrder | null>(null);

  useEffect(() => {
    if (!invoiceNo) return;
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

      await loadInvoice(String(invoiceNo));
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [invoiceNo, router]);

  const loadInvoice = async (invoiceKey: string) => {
    setError(null);
    const { data, error: rowsError } = await supabase
      .from("erp_gst_sales_register")
      .select(
        "invoice_number, invoice_no, order_number, order_date, customer_name, customer_gstin, place_of_supply_code, buyer_state_code, product_title, variant_title, hsn, quantity, taxable_value, gst_rate, cgst, sgst, igst, total_tax, payment_status, payment_gateway, fulfillment_status, source_order_id"
      )
      .eq("is_void", false)
      .eq("source", "shopify")
      .or(`invoice_number.eq.${invoiceKey},invoice_no.eq.${invoiceKey}`)
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
              <h1 style={headingStyle}>Tax Invoice</h1>
              <p style={subHeadingStyle}>GST Invoice for Shopify Order</p>
              <div style={buttonRowStyle} className="no-print">
                <span style={mutedTextStyle}>Invoice #{invoiceHeader?.invoice_number || invoiceHeader?.invoice_no}</span>
                <button type="button" style={printButtonStyle} onClick={() => window.print()}>
                  Print
                </button>
              </div>
            </header>

            <section style={metaGridStyle}>
              <div style={metaCardStyle}>
                <div style={{ fontWeight: 600 }}>{companyLegalName}</div>
                <div style={mutedTextStyle}>GSTIN: {branding?.gstin || "—"}</div>
                {companyAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div style={metaCardStyle}>
                <div style={{ fontWeight: 600 }}>Invoice Details</div>
                <div>Invoice No: {invoiceHeader?.invoice_number || invoiceHeader?.invoice_no || "—"}</div>
                <div>Invoice Date: {formatDate(invoiceHeader?.order_date || order?.order_created_at || null)}</div>
                <div>
                  Place of Supply: {invoiceHeader?.place_of_supply_code || invoiceHeader?.buyer_state_code || "—"}
                </div>
              </div>
              <div style={metaCardStyle}>
                <div style={{ fontWeight: 600 }}>Customer</div>
                <div>{invoiceHeader?.customer_name || order?.customer_email || "—"}</div>
                <div>GSTIN: {invoiceHeader?.customer_gstin || "—"}</div>
                {customerAddress.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </section>

            <section style={metaGridStyle}>
              <div style={metaCardStyle}>
                <div style={{ fontWeight: 600 }}>Payment</div>
                <div>Status: {invoiceHeader?.payment_status || "—"}</div>
                <div>Gateway: {invoiceHeader?.payment_gateway || "—"}</div>
              </div>
              <div style={metaCardStyle}>
                <div style={{ fontWeight: 600 }}>Fulfillment</div>
                <div>Status: {invoiceHeader?.fulfillment_status || "—"}</div>
              </div>
            </section>

            <table style={tableStyle} className="gst-lines-table">
              <thead>
                <tr>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>Variant</th>
                  <th style={thStyle}>HSN</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Taxable</th>
                  <th style={thStyle}>GST %</th>
                  <th style={thStyle}>CGST</th>
                  <th style={thStyle}>SGST</th>
                  <th style={thStyle}>IGST</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const taxable = round2(row.taxable_value ?? 0);
                  const cgst = round2(row.cgst ?? 0);
                  const sgst = round2(row.sgst ?? 0);
                  const igst = round2(row.igst ?? 0);
                  const total = round2(taxable + cgst + sgst + igst);
                  return (
                    <tr key={`${row.hsn}-${index}`}>
                      <td style={tdStyle}>{row.product_title || row.hsn || "—"}</td>
                      <td style={tdStyle}>{row.variant_title || "—"}</td>
                      <td style={tdStyle}>{row.hsn || "—"}</td>
                      <td style={tdStyle}>{row.quantity ?? 0}</td>
                      <td style={tdStyle}>{formatMoney(taxable)}</td>
                      <td style={tdStyle}>{row.gst_rate ?? "—"}</td>
                      <td style={tdStyle}>{formatMoney(cgst)}</td>
                      <td style={tdStyle}>{formatMoney(sgst)}</td>
                      <td style={tdStyle}>{formatMoney(igst)}</td>
                      <td style={tdStyle}>{formatMoney(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <section style={totalsGridStyle}>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Taxable Total</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.taxable)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>CGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.cgst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>SGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.sgst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>IGST</div>
                <div style={{ fontWeight: 600 }}>{formatMoney(totals.igst)}</div>
              </div>
              <div style={totalCardStyle}>
                <div style={mutedTextStyle}>Grand Total</div>
                <div style={{ fontWeight: 700 }}>{formatMoney(totals.total)}</div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
