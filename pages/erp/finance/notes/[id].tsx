import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../../../../components/erp/uiStyles";
import NoteForm from "../../../../components/finance/NoteForm";
import { noteGetSchema, type NoteFormPayload, type NoteGetPayload } from "../../../../lib/erp/notes";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>;

type Option = {
  id: string;
  name: string;
};

const vendorSchema = z.object({
  id: z.string().uuid(),
  legal_name: z.string(),
});

const statusBadgeStyle = (status: string) => {
  if (status === "approved") {
    return { ...badgeStyle, backgroundColor: "#ecfeff", color: "#0e7490" };
  }
  if (status === "cancelled") {
    return { ...badgeStyle, backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
  return { ...badgeStyle, backgroundColor: "#f1f5f9", color: "#0f172a" };
};

export default function NoteDetailPage() {
  const router = useRouter();
  const noteId = typeof router.query.id === "string" ? router.query.id : "";
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<NoteGetPayload | null>(null);
  const [vendors, setVendors] = useState<Option[]>([]);
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

      await loadVendors(context.companyId);
      await loadNote(noteId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady, noteId]);

  const loadVendors = async (companyId: string) => {
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

  const loadNote = async (id: string) => {
    if (!id) return;
    setError(null);
    const { data, error: noteError } = await supabase.rpc("erp_note_get", {
      p_note_id: id,
    });

    if (noteError) {
      setError(noteError.message || "Failed to load note.");
      return;
    }

    const parsed = noteGetSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse note payload.");
      return;
    }

    setNote(parsed.data);
  };

  const handleSave = async (payload: NoteFormPayload) => {
    if (!note) return;
    setIsWorking(true);
    setError(null);

    const { error: saveError } = await supabase.rpc("erp_note_upsert", {
      p_note: {
        ...payload,
        id: note.note.id,
      },
    });

    if (saveError) {
      setError(saveError.message);
      setIsWorking(false);
      return;
    }

    await loadNote(note.note.id);
    setIsWorking(false);
  };

  const handleApprove = async () => {
    if (!note) return;
    setIsWorking(true);
    setError(null);
    const { error: approveError } = await supabase.rpc("erp_note_approve", {
      p_note_id: note.note.id,
    });

    if (approveError) {
      setError(approveError.message);
      setIsWorking(false);
      return;
    }

    await loadNote(note.note.id);
    setIsWorking(false);
  };

  const handleCancel = async () => {
    if (!note) return;
    const reason = window.prompt("Why are you cancelling this note?");
    if (reason === null) return;

    setIsWorking(true);
    setError(null);
    const { error: cancelError } = await supabase.rpc("erp_note_cancel", {
      p_note_id: note.note.id,
      p_reason: reason,
    });

    if (cancelError) {
      setError(cancelError.message);
      setIsWorking(false);
      return;
    }

    await loadNote(note.note.id);
    setIsWorking(false);
  };


  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading note…</div>
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

  if (!note) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>{error || "Note not found."}</div>
      </ErpShell>
    );
  }

  const noteHeader = note.note;
  const isDraft = noteHeader.status === "draft";
  const isApproved = noteHeader.status === "approved";

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title={noteHeader.note_number ? `Note ${noteHeader.note_number}` : "Note"}
          description={`${noteHeader.party_name} · ${noteHeader.party_type === "customer" ? "Customer" : "Vendor"} · ${noteHeader.note_kind === "credit" ? "Credit" : "Debit"}`}
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span style={statusBadgeStyle(noteHeader.status)}>{noteHeader.status}</span>
              <Link href="/erp/finance/notes" style={secondaryButtonStyle}>
                Back to Notes
              </Link>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => {
                  if (typeof window !== "undefined" && noteHeader.id) {
                    window.open(`/erp/finance/notes/${noteHeader.id}/print`, "_blank");
                  }
                }}
              >
                Print / Save PDF
              </button>
              {isDraft && canWrite ? (
                <button type="button" style={primaryButtonStyle} onClick={handleApprove} disabled={isWorking}>
                  Approve
                </button>
              ) : null}
              {isApproved && canWrite ? (
                <button type="button" style={secondaryButtonStyle} onClick={handleCancel} disabled={isWorking}>
                  Cancel
                </button>
              ) : null}
            </div>
          }
        />

        <NoteForm
          vendors={vendors}
          initialValues={{
            party_type: noteHeader.party_type,
            note_kind: noteHeader.note_kind,
            note_date: noteHeader.note_date,
            party_id: noteHeader.party_id,
            party_name: noteHeader.party_name,
            currency: noteHeader.currency,
            source_type: noteHeader.source_type ?? "",
            source_id: noteHeader.source_id ?? "",
            reference_invoice_number: noteHeader.reference_invoice_number ?? "",
            reference_invoice_date: noteHeader.reference_invoice_date ?? "",
            reason: noteHeader.reason ?? "",
            place_of_supply: noteHeader.place_of_supply ?? "",
            lines: note.lines.map((line) => ({
              item_type: (line.item_type as "manual" | "variant") || "manual",
              variant: null,
              variant_id: line.variant_id ?? null,
              sku: line.sku ?? "",
              title: line.title ?? "",
              hsn: line.hsn ?? "",
              qty: line.qty ?? 0,
              unit_rate: line.unit_rate ?? 0,
              tax_rate: line.tax_rate ?? 0,
            })),
          }}
          submitLabel="Save Draft"
          canWrite={canWrite}
          readOnly={!isDraft}
          onSubmit={handleSave}
          error={error}
        />
      </div>
    </ErpShell>
  );
}
