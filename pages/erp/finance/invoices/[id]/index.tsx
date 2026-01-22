import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../../../../../components/erp/uiStyles";
import InvoiceForm from "../../../../../components/finance/InvoiceForm";
import { invoiceHeaderSchema, invoiceLineSchema, type InvoiceFormPayload } from "../../../../../lib/erp/invoices";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>;

const errorBannerStyle = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #fecaca",
  backgroundColor: "#fff1f2",
  color: "#b91c1c",
  fontSize: 13,
};

const statusBadgeStyle = (status: string) => {
  if (status === "issued") {
    return { ...badgeStyle, backgroundColor: "#ecfeff", color: "#0e7490" };
  }
  if (status === "cancelled") {
    return { ...badgeStyle, backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
  return { ...badgeStyle, backgroundColor: "#f1f5f9", color: "#0f172a" };
};

type InvoiceDetailState = {
  header: ReturnType<typeof invoiceHeaderSchema.parse>;
  lines: ReturnType<typeof invoiceLineSchema.parse>[];
};

export default function InvoiceDetailPage() {
  const router = useRouter();
  const invoiceId = typeof router.query.id === "string" ? router.query.id : "";
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetailState | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      await loadInvoice(invoiceId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady, invoiceId]);

  const loadInvoice = async (id: string) => {
    if (!id) return;
    setError(null);

    const { data, error: invoiceError } = await supabase
      .from("erp_invoices")
      .select(
        `id, doc_no, status, invoice_date, customer_name, customer_gstin, place_of_supply, place_of_supply_state_code, place_of_supply_state_name, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_state_code, billing_state_name, billing_pincode, billing_country, shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_state_code, shipping_state_name, shipping_pincode, shipping_country, currency, subtotal, tax_total, igst_total, cgst_total, sgst_total, total, taxable_amount, cgst_amount, sgst_amount, igst_amount, gst_amount, total_amount, is_inter_state, issued_at, issued_by, cancelled_at, cancelled_by, cancel_reason, created_at, updated_at, erp_invoice_lines(id, line_no, item_type, variant_id, sku, title, hsn, qty, unit_rate, discount_percent, tax_percent, taxable_amount, cgst_amount, sgst_amount, igst_amount, line_total)`
      )
      .eq("id", id)
      .order("line_no", { foreignTable: "erp_invoice_lines", ascending: true })
      .maybeSingle();

    if (invoiceError) {
      setError(invoiceError.message || "Failed to load invoice.");
      return;
    }

    if (!data) {
      setError("Invoice not found.");
      return;
    }

    const { erp_invoice_lines: lineRecords, ...headerRecord } = data as {
      erp_invoice_lines?: unknown[];
      [key: string]: unknown;
    };

    const headerParsed = invoiceHeaderSchema.safeParse(headerRecord);
    const linesParsed = invoiceLineSchema.array().safeParse(lineRecords ?? []);

    if (!headerParsed.success || !linesParsed.success) {
      setError("Failed to parse invoice payload.");
      return;
    }

    setInvoice({ header: headerParsed.data, lines: linesParsed.data });
  };

  const handleSave = async (payload: InvoiceFormPayload) => {
    if (!invoice) return;
    setIsWorking(true);
    setError(null);

    const { data: invoiceIdResult, error: headerError } = await supabase.rpc("erp_invoice_upsert", {
      p_invoice: { ...payload, id: invoice.header.id },
    });

    if (headerError) {
      setError(headerError.message || "Failed to save invoice draft.");
      setIsWorking(false);
      return;
    }

    for (let index = 0; index < payload.lines.length; index += 1) {
      const line = payload.lines[index];
      const { error: lineError } = await supabase.rpc("erp_invoice_line_upsert", {
        p_line: {
          id: line.id ?? null,
          invoice_id: invoiceIdResult ?? invoice.header.id,
          line_no: line.line_no ?? index + 1,
          item_type: line.item_type,
          variant_id: line.variant_id ?? null,
          sku: line.sku,
          title: line.title,
          hsn: line.hsn,
          qty: line.qty,
          unit_rate: line.unit_rate,
          discount_percent: line.discount_percent ?? 0,
          tax_percent: line.tax_percent ?? 0,
        },
      });

      if (lineError) {
        setError(lineError.message || "Failed to save invoice line.");
        setIsWorking(false);
        return;
      }
    }

    const { error: totalsError } = await supabase.rpc("erp_invoice_recompute_totals", {
      p_invoice_id: invoice.header.id,
    });

    if (totalsError) {
      setError(totalsError.message || "Failed to recompute totals.");
      setIsWorking(false);
      return;
    }

    await loadInvoice(invoice.header.id);
    setIsWorking(false);
  };

  const handleRecompute = async () => {
    if (!invoice) return;
    setIsWorking(true);
    setError(null);

    const { error: totalsError } = await supabase.rpc("erp_invoice_recompute_totals", {
      p_invoice_id: invoice.header.id,
    });

    if (totalsError) {
      setError(totalsError.message || "Failed to recompute totals.");
      setIsWorking(false);
      return;
    }

    await loadInvoice(invoice.header.id);
    setIsWorking(false);
  };

  const handleIssue = async () => {
    if (!invoice) return;
    setIsWorking(true);
    setError(null);

    const { error: totalsError } = await supabase.rpc("erp_invoice_recompute_totals", {
      p_invoice_id: invoice.header.id,
    });

    if (totalsError) {
      setError(totalsError.message || "Failed to recompute totals.");
      setIsWorking(false);
      return;
    }

    const { error: issueError } = await supabase.rpc("erp_invoice_issue", {
      p_invoice_id: invoice.header.id,
    });

    if (issueError) {
      setError(issueError.message || "Failed to issue invoice.");
      setIsWorking(false);
      return;
    }

    await loadInvoice(invoice.header.id);
    setIsWorking(false);
  };

  const handleCancel = async () => {
    if (!invoice) return;
    const reason = window.prompt("Why are you cancelling this invoice?");
    if (reason === null) return;

    setIsWorking(true);
    setError(null);
    const { error: cancelError } = await supabase.rpc("erp_invoice_cancel", {
      p_invoice_id: invoice.header.id,
      p_reason: reason,
    });

    if (cancelError) {
      setError(cancelError.message || "Failed to cancel invoice.");
      setIsWorking(false);
      return;
    }

    await loadInvoice(invoice.header.id);
    setIsWorking(false);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading invoice…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </ErpShell>
    );
  }

  if (!invoice) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>{error || "Invoice not found."}</div>
      </ErpShell>
    );
  }

  const invoiceHeader = invoice.header;
  const isDraft = invoiceHeader.status === "draft";
  const isCancelled = invoiceHeader.status === "cancelled";

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title={invoiceHeader.doc_no || "Draft Invoice"}
          description={`${invoiceHeader.customer_name} · ${invoiceHeader.invoice_date}`}
          rightActions={
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/erp/finance/invoices" style={secondaryButtonStyle}>
                Back to Invoices
              </Link>
              <Link href={`/erp/finance/invoices/${invoiceHeader.id}/print`} style={secondaryButtonStyle}>
                Print
              </Link>
            </div>
          }
        />

        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={statusBadgeStyle(invoiceHeader.status)}>{invoiceHeader.status}</span>
          {invoiceHeader.doc_no ? <span style={{ fontSize: 13 }}>Doc No: {invoiceHeader.doc_no}</span> : null}
          {invoiceHeader.cancel_reason ? (
            <span style={{ fontSize: 13, color: "#b91c1c" }}>Cancelled: {invoiceHeader.cancel_reason}</span>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button
            type="button"
            onClick={handleRecompute}
            style={secondaryButtonStyle}
            disabled={!canWrite || isWorking}
          >
            Recompute Totals
          </button>
          <button
            type="button"
            onClick={handleIssue}
            style={primaryButtonStyle}
            disabled={!canWrite || !isDraft || isWorking}
          >
            Issue Invoice
          </button>
          <button
            type="button"
            onClick={handleCancel}
            style={secondaryButtonStyle}
            disabled={!canWrite || isCancelled || isWorking}
          >
            Cancel Invoice
          </button>
        </div>

        <InvoiceForm
          initialValues={{
            invoice_date: invoiceHeader.invoice_date,
            customer_name: invoiceHeader.customer_name,
            customer_gstin: invoiceHeader.customer_gstin ?? "",
            place_of_supply: invoiceHeader.place_of_supply,
            place_of_supply_state_code: invoiceHeader.place_of_supply_state_code ?? "",
            place_of_supply_state_name: invoiceHeader.place_of_supply_state_name ?? "",
            currency: invoiceHeader.currency,
            billing_address_line1: invoiceHeader.billing_address_line1 ?? "",
            billing_address_line2: invoiceHeader.billing_address_line2 ?? "",
            billing_city: invoiceHeader.billing_city ?? "",
            billing_state: invoiceHeader.billing_state ?? "",
            billing_state_code: invoiceHeader.billing_state_code ?? "",
            billing_state_name: invoiceHeader.billing_state_name ?? "",
            billing_pincode: invoiceHeader.billing_pincode ?? "",
            billing_country: invoiceHeader.billing_country ?? "",
            shipping_address_line1: invoiceHeader.shipping_address_line1 ?? "",
            shipping_address_line2: invoiceHeader.shipping_address_line2 ?? "",
            shipping_city: invoiceHeader.shipping_city ?? "",
            shipping_state: invoiceHeader.shipping_state ?? "",
            shipping_state_code: invoiceHeader.shipping_state_code ?? "",
            shipping_state_name: invoiceHeader.shipping_state_name ?? "",
            shipping_pincode: invoiceHeader.shipping_pincode ?? "",
            shipping_country: invoiceHeader.shipping_country ?? "",
            lines: invoice.lines.map((line, index) => ({
              id: line.id,
              line_no: line.line_no ?? index + 1,
              item_type: line.item_type === "variant" ? "variant" : "manual",
              variant: null,
              variant_id: line.variant_id,
              sku: line.sku ?? "",
              title: line.title ?? "",
              hsn: line.hsn ?? "",
              qty: line.qty,
              unit_rate: line.unit_rate,
              discount_percent: line.discount_percent ?? 0,
              tax_percent: line.tax_percent ?? 0,
            })),
          }}
          submitLabel={isWorking ? "Saving…" : "Save Draft"}
          canWrite={canWrite}
          readOnly={!isDraft}
          onSubmit={handleSave}
          error={error}
        />
      </div>
    </ErpShell>
  );
}
