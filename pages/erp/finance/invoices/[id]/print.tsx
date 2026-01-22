import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";
import { invoiceHeaderSchema, invoiceLineSchema } from "../../../../../lib/erp/invoices";

type InvoicePrintPayload = {
  invoice: ReturnType<typeof invoiceHeaderSchema.parse>;
  lines: ReturnType<typeof invoiceLineSchema.parse>[];
};

type Issue = {
  path: string;
  message: string;
};

export default function InvoicePrintPage() {
  const router = useRouter();
  const { id } = router.query;
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorIssues, setErrorIssues] = useState<Issue[]>([]);
  const [invoice, setInvoice] = useState<InvoicePrintPayload | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [secondaryLogoLoaded, setSecondaryLogoLoaded] = useState(false);

  const logoUrl = branding?.bigonbuyLogoUrl ?? null;
  const secondaryLogoUrl = branding?.megaskaLogoUrl ?? null;

  useEffect(() => {
    setLogoLoaded(!logoUrl);
  }, [logoUrl]);

  useEffect(() => {
    setSecondaryLogoLoaded(!secondaryLogoUrl);
  }, [secondaryLogoUrl]);

  useEffect(() => {
    if (!id) return;
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadData(id as string, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  useEffect(() => {
    if (loading || !invoice || !branding?.loaded) return;
    if (!logoLoaded || !secondaryLogoLoaded) return;

    let active = true;
    let timer: number | undefined;

    const waitForPrint = async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Ignore font loading failures; still attempt to print.
        }
      }

      if (!active) return;
      timer = window.setTimeout(() => {
        if (active) window.print();
      }, 500);
    };

    waitForPrint();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, invoice, branding?.loaded, logoLoaded, secondaryLogoLoaded]);

  async function loadData(invoiceId: string, isActiveFetch = true) {
    setError("");
    setErrorIssues([]);

    const { data, error: invoiceError } = await supabase
      .from("erp_invoices")
      .select(
        `id, doc_no, status, invoice_date, customer_name, customer_gstin, place_of_supply, place_of_supply_state_code, place_of_supply_state_name, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_state_code, billing_state_name, billing_pincode, billing_country, shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_state_code, shipping_state_name, shipping_pincode, shipping_country, currency, subtotal, tax_total, igst_total, cgst_total, sgst_total, total, taxable_amount, cgst_amount, sgst_amount, igst_amount, gst_amount, total_amount, is_inter_state, issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, erp_invoice_lines(id, line_no, item_type, variant_id, sku, title, hsn, qty, unit_rate, discount_percent, tax_percent, taxable_amount, cgst_amount, sgst_amount, igst_amount, line_total)`
      )
      .eq("id", invoiceId)
      .order("line_no", { foreignTable: "erp_invoice_lines", ascending: true })
      .maybeSingle();

    if (invoiceError) {
      if (isActiveFetch) setError(invoiceError.message || "Failed to load invoice.");
      return;
    }

    if (!data) {
      if (isActiveFetch) setError("Invoice not found.");
      return;
    }

    const { erp_invoice_lines: lineRecords, ...headerRecord } = data as {
      erp_invoice_lines?: unknown[];
      [key: string]: unknown;
    };

    const headerParsed = invoiceHeaderSchema.safeParse(headerRecord);
    const linesParsed = invoiceLineSchema.array().safeParse(lineRecords ?? []);

    if (!headerParsed.success || !linesParsed.success) {
      if (isActiveFetch) setError("Failed to parse invoice payload.");
      return;
    }

    if (isActiveFetch) {
      setInvoice({ invoice: headerParsed.data, lines: linesParsed.data });
    }
  }

  const invoiceHeader = invoice?.invoice;
  const lines = invoice?.lines ?? [];

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-IN");
  };

  const currencyCode = branding?.currencyCode || invoiceHeader?.currency || "INR";

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(value));
  };

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = line.qty ?? 0;
        const unitRate = line.unit_rate ?? 0;
        const discountPercent = line.discount_percent ?? 0;
        const taxPercent = line.tax_percent ?? 0;
        const gross = round2(qty * unitRate);
        const discount = round2(gross * (discountPercent / 100));
        const taxable = round2(line.taxable_amount ?? gross - discount);
        const tax = round2(taxable * (taxPercent / 100));
        const lineTotal = round2(line.line_total ?? taxable + tax);
        const isInterState = Boolean(
          invoiceHeader?.is_inter_state ??
            (invoiceHeader?.place_of_supply_state_code &&
              invoiceHeader?.billing_state_code &&
              invoiceHeader.place_of_supply_state_code !== invoiceHeader.billing_state_code)
        );
        const igst = round2(line.igst_amount ?? (isInterState ? tax : 0));
        const cgst = round2(line.cgst_amount ?? (isInterState ? 0 : tax / 2));
        const sgst = round2(line.sgst_amount ?? (isInterState ? 0 : tax - cgst));
        return {
          taxable_amount: acc.taxable_amount + taxable,
          cgst_amount: acc.cgst_amount + cgst,
          sgst_amount: acc.sgst_amount + sgst,
          igst_amount: acc.igst_amount + igst,
          gst_amount: acc.gst_amount + tax,
          total_amount: acc.total_amount + lineTotal,
        };
      },
      { taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, gst_amount: 0, total_amount: 0 }
    );
  }, [lines, invoiceHeader]);

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const billingStateLabel = invoiceHeader?.billing_state_name
    ? `${invoiceHeader.billing_state_name} (${invoiceHeader.billing_state_code ?? ""})`
    : invoiceHeader?.billing_state || "";

  const shippingStateLabel = invoiceHeader?.shipping_state_name
    ? `${invoiceHeader.shipping_state_name} (${invoiceHeader.shipping_state_code ?? ""})`
    : invoiceHeader?.shipping_state || "";

  const billingLines = [
    invoiceHeader?.billing_address_line1,
    invoiceHeader?.billing_address_line2,
    invoiceHeader?.billing_city,
    billingStateLabel,
    invoiceHeader?.billing_pincode,
    invoiceHeader?.billing_country,
  ]
    .filter(Boolean)
    .map((line) => String(line));

  const shippingLines = [
    invoiceHeader?.shipping_address_line1,
    invoiceHeader?.shipping_address_line2,
    invoiceHeader?.shipping_city,
    shippingStateLabel,
    invoiceHeader?.shipping_pincode,
    invoiceHeader?.shipping_country,
  ]
    .filter(Boolean)
    .map((line) => String(line));

  const placeOfSupplyLabel = invoiceHeader?.place_of_supply_state_name
    ? `${invoiceHeader.place_of_supply_state_name} (${invoiceHeader.place_of_supply_state_code ?? ""})`
    : invoiceHeader?.place_of_supply || "—";

  const supplyTypeLabel =
    invoiceHeader?.is_inter_state === null || invoiceHeader?.is_inter_state === undefined
      ? "—"
      : invoiceHeader.is_inter_state
        ? "Inter-state (IGST)"
        : "Intra-state (CGST + SGST)";

  return (
    <div style={printPageStyle} className="invoice-print invoice-print-root">
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 12mm 14mm;
          }

          html,
          body {
            height: auto;
          }

          body {
            background: #fff;
            margin: 0;
            transform: none !important;
            zoom: 1 !important;
          }

          .invoice-print,
          .invoice-sheet,
          .invoice-body,
          .invoice-header,
          .invoice-footer {
            overflow: visible !important;
            transform: none !important;
          }

          .invoice-print-root {
            max-width: none;
            margin: 0 !important;
            padding: 0 !important;
            display: block;
            transform: none !important;
            zoom: 1 !important;
          }

          .invoice-sheet {
            width: 100%;
            max-width: 100%;
            min-height: calc(297mm - 26mm);
            padding: 0;
            box-sizing: border-box;
            margin: 0 auto;
            position: relative;
            display: flex;
            flex-direction: column;
            transform: none !important;
            zoom: 1 !important;
          }

          .invoice-header {
            position: static;
            height: auto;
            padding: 0 0 6mm;
            background: #fff;
            display: block;
            margin-bottom: 10px;
            transform: none !important;
            zoom: 1 !important;
          }

          .invoice-footer {
            position: static;
            height: auto;
            padding: 6mm 0 0;
            background: #fff;
            display: block;
            margin-top: 12px;
            transform: none !important;
            zoom: 1 !important;
          }

          .invoice-body {
            margin: 0 !important;
            padding: 0 !important;
            display: block;
            flex: 1;
            transform: none !important;
            zoom: 1 !important;
          }

          .print-footer {
            margin-top: auto;
          }

          .invoice-print-section {
            display: block;
            break-inside: auto;
            page-break-inside: auto;
          }

          .invoice-print-table {
            border-collapse: collapse;
            page-break-inside: auto;
            table-layout: fixed;
            width: 100%;
          }

          .invoice-print-table thead {
            display: table-header-group;
          }

          .invoice-print-table tbody {
            display: table-row-group;
          }

          .invoice-print-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .invoice-print-table th,
          .invoice-print-table td {
            padding: 8px 6px !important;
          }
        }
      `}</style>
      <div style={printSheetStyle} className="print-page invoice-sheet">
        {error ? (
          <div style={printErrorStyle}>
            {error}
            {errorIssues.length > 0 ? (
              <ul>
                {errorIssues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <header style={printHeaderRowStyle} className="invoice-header">
          <div style={printBrandBlockStyle}>
            <div style={printBrandRowStyle}>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Company logo"
                  style={printLogoStyle}
                  onLoad={() => setLogoLoaded(true)}
                  onError={() => setLogoLoaded(true)}
                />
              ) : (
                <div style={printLogoFallbackStyle}>BIGONBUY</div>
              )}
              <div>
                <div style={printCompanyNameStyle}>{companyLegalName}</div>
                <div style={printCompanySubTextStyle}>GSTIN: {branding?.gstin || "—"}</div>
                {companyAddressLines.map((line) => (
                  <div key={line} style={printCompanyAddressStyle}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
            <div style={printDocTitleStyle}>Tax Invoice</div>
          </div>
          <div style={printMetaCardStyle}>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Invoice No</span>
              <span style={printMetaValueStyle}>{invoiceHeader?.doc_no || "Draft"}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Invoice Date</span>
              <span style={printMetaValueStyle}>{formatDate(invoiceHeader?.invoice_date)}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Place of Supply</span>
              <span style={printMetaValueStyle}>{placeOfSupplyLabel}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Supply Type</span>
              <span style={printMetaValueStyle}>{supplyTypeLabel}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Status</span>
              <span style={{ ...printMetaValueStyle, color: "#6b7280", fontWeight: 500 }}>
                {invoiceHeader?.status || "—"}
              </span>
            </div>
          </div>
        </header>

        <div style={printBodyStyle} className="invoice-body">
          <section style={printSectionStyle} className="invoice-print-section">
            <div style={printSectionTitleStyle}>Bill To</div>
            <div style={printPartyGridStyle}>
              <div>
                <div style={printPartyNameStyle}>{invoiceHeader?.customer_name || "—"}</div>
                <div style={printDetailTextStyle}>GSTIN: {invoiceHeader?.customer_gstin || "—"}</div>
                {billingLines.length > 0 ? (
                  billingLines.map((line) => (
                    <div key={line} style={printDetailTextStyle}>
                      {line}
                    </div>
                  ))
                ) : (
                  <div style={printDetailTextStyle}>No billing address on file.</div>
                )}
              </div>
              <div>
                <div style={printDetailLabelStyle}>Ship To</div>
                {shippingLines.length > 0 ? (
                  shippingLines.map((line) => (
                    <div key={line} style={printDetailTextStyle}>
                      {line}
                    </div>
                  ))
                ) : (
                  <div style={printDetailTextStyle}>No shipping address on file.</div>
                )}
              </div>
            </div>
          </section>

          <section style={printSectionStyle} className="invoice-print-section">
            <table style={printTableStyle} className="invoice-print-table">
              <thead>
                <tr>
                  <th style={printTableHeaderStyle}>Sl No</th>
                  <th style={printTableHeaderStyle}>Description</th>
                  <th style={printTableHeaderStyle}>HSN</th>
                  <th style={printTableHeaderStyle}>Qty</th>
                  <th style={printTableHeaderStyle}>Rate</th>
                  <th style={printTableHeaderStyle}>Taxable</th>
                  <th style={printTableHeaderStyle}>Tax %</th>
                  <th style={printTableHeaderStyle}>CGST</th>
                  <th style={printTableHeaderStyle}>SGST</th>
                  <th style={printTableHeaderStyle}>IGST</th>
                  <th style={printTableHeaderStyle}>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td style={printTableCellStyle} colSpan={11}>
                      No line items.
                    </td>
                  </tr>
                ) : (
                  lines.map((line, index) => (
                    <tr key={line.id}>
                      <td style={printTableCellStyle}>{index + 1}</td>
                      <td style={printTableCellStyle}>{line.title || line.sku || "Item"}</td>
                      <td style={printTableCellStyle}>{line.hsn || "—"}</td>
                      <td style={printTableCellStyle}>{line.qty}</td>
                      <td style={printTableCellStyle}>{formatMoney(line.unit_rate)}</td>
                      <td style={printTableCellStyle}>{formatMoney(line.taxable_amount ?? null)}</td>
                      <td style={printTableCellStyle}>{(line.tax_percent ?? 0).toFixed(2)}%</td>
                      <td style={printTableCellStyle}>{formatMoney(line.cgst_amount ?? 0)}</td>
                      <td style={printTableCellStyle}>{formatMoney(line.sgst_amount ?? 0)}</td>
                      <td style={printTableCellStyle}>{formatMoney(line.igst_amount ?? 0)}</td>
                      <td style={printTableCellStyle}>{formatMoney(line.line_total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section style={printTotalsSectionStyle} className="invoice-print-section no-break">
            <div style={printTotalsRowStyle}>
              <span style={printMetaLabelStyle}>Taxable</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.taxable_amount ?? totals.taxable_amount)}
              </span>
            </div>
            <div style={printTotalsRowStyle}>
              <span style={printMetaLabelStyle}>CGST</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.cgst_amount ?? totals.cgst_amount)}
              </span>
            </div>
            <div style={printTotalsRowStyle}>
              <span style={printMetaLabelStyle}>SGST</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.sgst_amount ?? totals.sgst_amount)}
              </span>
            </div>
            <div style={printTotalsRowStyle}>
              <span style={printMetaLabelStyle}>IGST</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.igst_amount ?? totals.igst_amount)}
              </span>
            </div>
            <div style={printTotalsRowStyle}>
              <span style={printMetaLabelStyle}>Total GST</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.gst_amount ?? totals.gst_amount)}
              </span>
            </div>
            <div style={{ ...printTotalsRowStyle, fontWeight: 700 }}>
              <span style={printMetaLabelStyle}>Grand Total</span>
              <span style={printTotalsValueStyle}>
                {formatMoney(invoiceHeader?.total_amount ?? totals.total_amount)}
              </span>
            </div>
          </section>
        </div>

        <footer style={printFooterStyle} className="invoice-footer print-footer">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={printFooterTextStyle}>
              {invoiceHeader?.doc_no || "Draft"} – Page <span className="pageNumber"></span> / <span className="totalPages"></span>
            </div>
            <div style={printFooterTextStyle}>{branding?.footerText || "Generated by Bigonbuy ERP"}</div>
          </div>
          <div style={printFooterPageStyle}>
            {secondaryLogoUrl ? (
              <img
                src={secondaryLogoUrl}
                alt="Secondary logo"
                style={printSecondaryLogoStyle}
                onLoad={() => setSecondaryLogoLoaded(true)}
                onError={() => setSecondaryLogoLoaded(true)}
              />
            ) : null}
            <div style={printFooterTextStyle}>MEGASKA</div>
          </div>
        </footer>
      </div>
    </div>
  );
}

const printPageStyle = {
  fontFamily: "Inter, sans-serif",
  backgroundColor: "#f8fafc",
  padding: 24,
  color: "#111827",
};

const printSheetStyle = {
  backgroundColor: "white",
  padding: "24px 32px 80px",
  borderRadius: 16,
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12)",
  position: "relative" as const,
};

const printErrorStyle = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #fecaca",
  backgroundColor: "#fff1f2",
  color: "#b91c1c",
  fontSize: 13,
};

const printHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  alignItems: "flex-start",
  borderBottom: "1px solid #e5e7eb",
  paddingBottom: 16,
};

const printBrandBlockStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
};

const printBrandRowStyle = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

const printLogoStyle = {
  height: 54,
  width: 54,
  objectFit: "contain" as const,
};

const printSecondaryLogoStyle = {
  height: 28,
  objectFit: "contain" as const,
};

const printLogoFallbackStyle = {
  height: 54,
  width: 54,
  borderRadius: 12,
  backgroundColor: "#0f172a",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const printCompanyNameStyle = {
  fontSize: 18,
  fontWeight: 700,
};

const printCompanySubTextStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const printCompanyAddressStyle = {
  fontSize: 12,
  color: "#4b5563",
};

const printDocTitleStyle = {
  fontSize: 20,
  fontWeight: 700,
};

const printMetaCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
  minWidth: 220,
  backgroundColor: "#f8fafc",
};

const printMetaRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  fontSize: 12,
  marginBottom: 6,
};

const printMetaLabelStyle = {
  color: "#6b7280",
};

const printMetaValueStyle = {
  fontWeight: 600,
};

const printBodyStyle = {
  marginTop: 20,
  display: "flex",
  flexDirection: "column" as const,
  gap: 20,
};

const printSectionStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
};

const printSectionTitleStyle = {
  fontSize: 13,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#6b7280",
  marginBottom: 8,
};

const printPartyGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 24,
};

const printPartyNameStyle = {
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 4,
};

const printDetailLabelStyle = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 6,
};

const printDetailTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  marginBottom: 2,
};

const printTableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 12,
};

const printTableHeaderStyle = {
  textAlign: "left" as const,
  padding: "6px 4px",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

const printTableCellStyle = {
  padding: "8px 4px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top" as const,
};

const printTotalsSectionStyle = {
  marginLeft: "auto",
  maxWidth: 320,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
};

const printTotalsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 6,
  fontSize: 12,
};

const printTotalsValueStyle = {
  fontWeight: 600,
};

const printFooterStyle = {
  borderTop: "1px solid #e5e7eb",
  marginTop: 24,
  paddingTop: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 11,
  color: "#6b7280",
};

const printFooterTextStyle = {
  fontSize: 11,
  color: "#6b7280",
};

const printFooterPageStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
