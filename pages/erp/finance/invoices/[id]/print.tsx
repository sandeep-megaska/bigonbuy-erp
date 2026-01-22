import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";
import { invoiceHeaderSchema, invoiceLineSchema } from "../../../../../lib/erp/invoices";

type InvoicePrintPayload = {
  invoice: ReturnType<typeof invoiceHeaderSchema.parse>;
  lines: ReturnType<typeof invoiceLineSchema.array().parse>;
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
        `id, doc_no, status, invoice_date, customer_name, customer_gstin, place_of_supply, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_pincode, billing_country, shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_pincode, shipping_country, currency, subtotal, tax_total, igst_total, cgst_total, sgst_total, total, issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, erp_invoice_lines(id, line_no, item_type, variant_id, sku, title, hsn, qty, unit_rate, tax_rate, line_subtotal, line_tax, line_total)`
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
        const taxRate = line.tax_rate ?? 0;
        const lineSubtotal = round2(line.line_subtotal ?? qty * unitRate);
        const lineTax = round2(line.line_tax ?? lineSubtotal * (taxRate / 100));
        const lineTotal = round2(line.line_total ?? lineSubtotal + lineTax);
        return {
          subtotal: acc.subtotal + lineSubtotal,
          tax_total: acc.tax_total + lineTax,
          total: acc.total + lineTotal,
        };
      },
      { subtotal: 0, tax_total: 0, total: 0 }
    );
  }, [lines]);

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const billingLines = [
    invoiceHeader?.billing_address_line1,
    invoiceHeader?.billing_address_line2,
    invoiceHeader?.billing_city,
    invoiceHeader?.billing_state,
    invoiceHeader?.billing_pincode,
    invoiceHeader?.billing_country,
  ].filter(Boolean) as string[];

  const shippingLines = [
    invoiceHeader?.shipping_address_line1,
    invoiceHeader?.shipping_address_line2,
    invoiceHeader?.shipping_city,
    invoiceHeader?.shipping_state,
    invoiceHeader?.shipping_pincode,
    invoiceHeader?.shipping_country,
  ].filter(Boolean) as string[];

  return (
    <div style={{ padding: 32, fontFamily: "Inter, sans-serif", color: "#111827" }}>
      {error ? (
        <div style={{ marginBottom: 16, color: "#b91c1c" }}>
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

      <header style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Tax Invoice</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6b7280" }}>
            {invoiceHeader?.doc_no || "Draft"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Company logo"
              style={{ height: 48, objectFit: "contain" }}
              onLoad={() => setLogoLoaded(true)}
              onError={() => setLogoLoaded(true)}
            />
          ) : null}
          {secondaryLogoUrl ? (
            <img
              src={secondaryLogoUrl}
              alt="Secondary logo"
              style={{ height: 32, objectFit: "contain" }}
              onLoad={() => setSecondaryLogoLoaded(true)}
              onError={() => setSecondaryLogoLoaded(true)}
            />
          ) : null}
        </div>
      </header>

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>From</h2>
          <p style={{ margin: "8px 0 0", fontWeight: 600 }}>{companyLegalName}</p>
          {companyAddressLines.map((line) => (
            <p key={line} style={{ margin: "2px 0", fontSize: 13, color: "#4b5563" }}>
              {line}
            </p>
          ))}
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Invoice Details</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13 }}>
            <strong>Invoice Date:</strong> {formatDate(invoiceHeader?.invoice_date)}
          </p>
          <p style={{ margin: "4px 0", fontSize: 13 }}>
            <strong>Place of Supply:</strong> {invoiceHeader?.place_of_supply || "—"}
          </p>
          <p style={{ margin: "4px 0", fontSize: 13 }}>
            <strong>Status:</strong> {invoiceHeader?.status || "—"}
          </p>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Bill To</h2>
          <p style={{ margin: "8px 0 0", fontWeight: 600 }}>{invoiceHeader?.customer_name || "—"}</p>
          {invoiceHeader?.customer_gstin ? (
            <p style={{ margin: "2px 0", fontSize: 13 }}>GSTIN: {invoiceHeader.customer_gstin}</p>
          ) : null}
          {billingLines.length > 0 ? (
            billingLines.map((line) => (
              <p key={line} style={{ margin: "2px 0", fontSize: 13, color: "#4b5563" }}>
                {line}
              </p>
            ))
          ) : (
            <p style={{ margin: "2px 0", fontSize: 13, color: "#6b7280" }}>No billing address on file.</p>
          )}
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Ship To</h2>
          {shippingLines.length > 0 ? (
            shippingLines.map((line) => (
              <p key={line} style={{ margin: "2px 0", fontSize: 13, color: "#4b5563" }}>
                {line}
              </p>
            ))
          ) : (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6b7280" }}>No shipping address on file.</p>
          )}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ paddingBottom: 8 }}>Item</th>
              <th style={{ paddingBottom: 8 }}>HSN</th>
              <th style={{ paddingBottom: 8 }}>Qty</th>
              <th style={{ paddingBottom: 8 }}>Rate</th>
              <th style={{ paddingBottom: 8 }}>Tax %</th>
              <th style={{ paddingBottom: 8, textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 0" }}>{line.title || line.sku || "Item"}</td>
                <td style={{ padding: "8px 0" }}>{line.hsn || "—"}</td>
                <td style={{ padding: "8px 0" }}>{line.qty}</td>
                <td style={{ padding: "8px 0" }}>{formatMoney(line.unit_rate)}</td>
                <td style={{ padding: "8px 0" }}>{line.tax_rate}%</td>
                <td style={{ padding: "8px 0", textAlign: "right" }}>{formatMoney(line.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
        <div style={{ minWidth: 240 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Subtotal</span>
            <span>{formatMoney(invoiceHeader?.subtotal ?? totals.subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Tax</span>
            <span>{formatMoney(invoiceHeader?.tax_total ?? totals.tax_total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>Total</span>
            <span>{formatMoney(invoiceHeader?.total ?? totals.total)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
