import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { noteListResponseSchema, type NoteListRow } from "../../../../lib/erp/notes";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
  session?: { access_token?: string | null } | null;
};

const today = () => new Date().toISOString().slice(0, 10);

const startOfMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.toISOString().slice(0, 10);
};

const statusBadgeStyle = (status: string) => {
  if (status === "approved") {
    return { ...badgeStyle, backgroundColor: "#ecfeff", color: "#0e7490" };
  }
  if (status === "cancelled") {
    return { ...badgeStyle, backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
  return { ...badgeStyle, backgroundColor: "#f1f5f9", color: "#0f172a" };
};

export default function NotesListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteListRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [partyType, setPartyType] = useState("");
  const [noteKind, setNoteKind] = useState("");
  const [status, setStatus] = useState("");
  const [docNoQuery, setDocNoQuery] = useState("");
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());

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

      await loadNotes({
        initialFrom: startOfMonth(),
        initialTo: today(),
        accessToken: context.session?.access_token || null,
      });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const loadNotes = async (overrides?: { initialFrom?: string; initialTo?: string; accessToken?: string | null }) => {
    setIsLoading(true);
    setError(null);

    const effectiveFrom = overrides?.initialFrom ?? fromDate;
    const effectiveTo = overrides?.initialTo ?? toDate;

    try {
      const token = overrides?.accessToken ?? ctx?.session?.access_token;
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/erp_notes_list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          p_party_type: partyType || null,
          p_note_kind: noteKind || null,
          p_status: status || null,
          p_from: effectiveFrom || null,
          p_to: effectiveTo || null,
          p_doc_no: docNoQuery || null,
          p_limit: 200,
          p_offset: 0,
        }),
      });

      const responseText = await response.text();
      let payload: unknown = null;
      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        throw new Error(
          `Failed to load note list (HTTP ${response.status}). Response: ${responseText.slice(0, 500) || "<empty>"}`
        );
      }

      if (!response.ok) {
        const message =
          payload && typeof payload === "object"
            ? (payload as { error?: string; message?: string }).error ||
              (payload as { error?: string; message?: string }).message
            : null;
        throw new Error(message || `Failed to load note list (HTTP ${response.status}).`);
      }

      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadError = (payload as { error?: string; message?: string }).error ||
          (payload as { error?: string; message?: string }).message;
        if (payloadError) {
          setError(payloadError);
          setNotes([]);
          setIsLoading(false);
          return;
        }
      }

      const rows = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown[] }).rows)
          ? (payload as { rows: unknown[] }).rows
          : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
            ? (payload as { data: unknown[] }).data
            : [];

      const parsed = noteListResponseSchema.safeParse(rows);
      if (!parsed.success) {
        const payloadMessage =
          payload && typeof payload === "object"
            ? (payload as { message?: string; error?: string }).message ||
              (payload as { message?: string; error?: string }).error
            : null;
        throw new Error(payloadMessage || "Failed to parse note list response rows.");
      }

      setNotes(parsed.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load note list.");
      setNotes([]);
    }
    setIsLoading(false);
  };

  const totals = useMemo(() => notes.reduce((sum, note) => sum + Number(note.total || 0), 0), [notes]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading credit/debit notes…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Credit / Debit Notes"
          description="Create and track customer and vendor credit/debit notes."
          rightActions={
            canWrite ? (
              <Link href="/erp/finance/notes/new" style={primaryButtonStyle}>
                New Note
              </Link>
            ) : undefined
          }
        />

        <div style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Doc Number</span>
              <input
                value={docNoQuery}
                onChange={(event) => setDocNoQuery(event.target.value)}
                placeholder="FY25-26/CN/000001"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Party Type</span>
              <select value={partyType} onChange={(event) => setPartyType(event.target.value)} style={inputStyle}>
                <option value="">All</option>
                <option value="customer">Customer</option>
                <option value="vendor">Vendor</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Note Kind</span>
              <select value={noteKind} onChange={(event) => setNoteKind(event.target.value)} style={inputStyle}>
                <option value="">All</option>
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>From</span>
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>To</span>
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
            </label>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" onClick={() => loadNotes()} style={secondaryButtonStyle}>
              Apply Filters
            </button>
            <div style={{ fontSize: 13, color: "#4b5563" }}>Total value: ₹{totals.toFixed(2)}</div>
          </div>
        </div>

        {error ? <div style={cardStyle}>{error}</div> : null}

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={tableHeaderCellStyle}>Note #</th>
              <th style={tableHeaderCellStyle}>Type</th>
              <th style={tableHeaderCellStyle}>Party</th>
              <th style={tableHeaderCellStyle}>Date</th>
              <th style={tableHeaderCellStyle}>Status</th>
              <th style={tableHeaderCellStyle}>Total</th>
              <th style={tableHeaderCellStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td style={tableCellStyle} colSpan={7}>
                  Loading notes…
                </td>
              </tr>
            ) : notes.length === 0 ? (
              <tr>
                <td style={tableCellStyle} colSpan={7}>
                  No notes found for the selected filters.
                </td>
              </tr>
            ) : (
              notes.map((note) => (
                <tr key={note.id}>
                  <td style={tableCellStyle}>
                    {note.note_number || ""}
                  </td>
                  <td style={tableCellStyle}>
                    {note.party_type === "customer" ? "Customer" : "Vendor"} · {note.note_kind === "credit" ? "Credit" : "Debit"}
                  </td>
                  <td style={tableCellStyle}>{note.party_name}</td>
                  <td style={tableCellStyle}>{note.note_date}</td>
                  <td style={tableCellStyle}>
                    <span style={statusBadgeStyle(note.status)}>{note.status}</span>
                  </td>
                  <td style={tableCellStyle}>₹{Number(note.total || 0).toFixed(2)}</td>
                  <td style={tableCellStyle}>
                    <Link href={`/erp/finance/notes/${note.id}`} style={secondaryButtonStyle}>
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
