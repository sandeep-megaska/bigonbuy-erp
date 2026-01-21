import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import NoteForm from "../../../../components/finance/NoteForm";
import { type NoteFormPayload } from "../../../../lib/erp/notes";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type Option = {
  id: string;
  name: string;
};

const vendorSchema = z.object({
  id: z.string().uuid(),
  legal_name: z.string(),
});

const today = () => new Date().toISOString().slice(0, 10);

export default function NoteCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Option[]>([]);

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

      await loadVendors(context.companyId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadVendors = async (companyId: string) => {
    setError(null);
    const { data, error: vendorError } = await supabase
      .from("erp_vendors")
      .select("id, legal_name")
      .eq("company_id", companyId)
      .order("legal_name");

    if (vendorError) {
      setError(vendorError.message || "Failed to load vendors.");
      return;
    }

    const parsed = vendorSchema.array().safeParse(data ?? []);
    if (!parsed.success) {
      setError("Failed to parse vendor list.");
      return;
    }

    setVendors(parsed.data.map((vendor) => ({ id: vendor.id, name: vendor.legal_name })));
  };

  const handleSubmit = async (payload: NoteFormPayload) => {
    setError(null);
    const { data, error: insertError } = await supabase.rpc("erp_note_upsert", {
      p_note: payload,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse created note id.");
      return;
    }

    await router.push(`/erp/finance/notes/${parsed.data}`);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading credit/debit note form…</div>
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
          title="New Credit / Debit Note"
          description="Capture adjustments for customers or vendors."
          rightActions={
            <Link href="/erp/finance/notes" style={secondaryButtonStyle}>
              Back to Notes
            </Link>
          }
        />

        <NoteForm
          vendors={vendors}
          initialValues={{
            party_type: "customer",
            note_kind: "credit",
            note_date: today(),
            party_id: null,
            party_name: "",
            currency: "INR",
            source_type: "",
            source_id: "",
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
