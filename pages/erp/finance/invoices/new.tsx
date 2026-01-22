import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import InvoiceForm from "../../../../components/finance/InvoiceForm";
import { type InvoiceFormPayload } from "../../../../lib/erp/invoices";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>;

const today = () => new Date().toISOString().slice(0, 10);

export default function InvoiceCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  useEffect(() => {
    let active = true;

    (async () => {
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

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleSubmit = async (payload: InvoiceFormPayload) => {
    setError(null);
    const { data: invoiceId, error: headerError } = await supabase.rpc("erp_invoice_upsert", {
      p_invoice: payload,
    });

    if (headerError) {
      setError(headerError.message || "Failed to save invoice draft.");
      return;
    }

    if (!invoiceId) {
      setError("Failed to create invoice draft.");
      return;
    }

    for (let index = 0; index < payload.lines.length; index += 1) {
      const line = payload.lines[index];
      const { error: lineError } = await supabase.rpc("erp_invoice_line_upsert", {
        p_line: {
          id: line.id ?? null,
          invoice_id: invoiceId,
          line_no: line.line_no ?? index + 1,
          item_type: line.item_type,
          variant_id: line.variant_id ?? null,
          sku: line.sku,
          title: line.title,
          hsn: line.hsn,
          qty: line.qty,
          unit_rate: line.unit_rate,
          tax_rate: line.tax_rate,
        },
      });

      if (lineError) {
        setError(lineError.message || "Failed to save invoice line.");
        return;
      }
    }

    const { error: totalsError } = await supabase.rpc("erp_invoice_recompute_totals", {
      p_invoice_id: invoiceId,
    });

    if (totalsError) {
      setError(totalsError.message || "Failed to recompute totals.");
      return;
    }

    await router.push(`/erp/finance/invoices/${invoiceId}`);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading invoice form…</div>
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

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="New Invoice"
          description="Create a draft invoice and add line items."
          rightActions={
            <Link href="/erp/finance/invoices" style={secondaryButtonStyle}>
              Back to Invoices
            </Link>
          }
        />

        <InvoiceForm
          initialValues={{
            invoice_date: today(),
            customer_name: "",
            customer_gstin: "",
            place_of_supply: "",
            currency: "INR",
            billing_address_line1: "",
            billing_address_line2: "",
            billing_city: "",
            billing_state: "",
            billing_pincode: "",
            billing_country: "",
            shipping_address_line1: "",
            shipping_address_line2: "",
            shipping_city: "",
            shipping_state: "",
            shipping_pincode: "",
            shipping_country: "",
            lines: [
              {
                item_type: "manual",
                variant: null,
                variant_id: null,
                sku: "",
                title: "",
                hsn: "",
                qty: 1,
                unit_rate: 0,
                tax_rate: 0,
                line_no: 1,
              },
            ],
          }}
          submitLabel="Save Draft"
          canWrite={canWrite}
          onSubmit={handleSubmit}
          error={error}
        />
      </div>
    </ErpShell>
  );
}
