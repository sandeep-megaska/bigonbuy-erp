import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, inputStyle, pageContainerStyle, secondaryButtonStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";
import LoanForm, { LoanFormErrors, LoanFormValues, LOAN_TYPE_OPTIONS, upsertCustomTypeNote, validateLoanForm } from "../../../../components/finance/LoanForm";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type ScheduleRow = {
  id: string;
  line_no: number;
  due_date: string;
  emi_amount: number;
  principal_component: number;
  interest_component: number;
  status: string;
  notes: string | null;
  journal_id: string | null;
  journal_no: string | null;
};

export default function LoanDetailPage() {
  const router = useRouter();
  const loanId = first(router.query.loanId);
  const [loan, setLoan] = useState<any>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [form, setForm] = useState<LoanFormValues | null>(null);
  const [customLoanType, setCustomLoanType] = useState("");
  const [legacyLoanType, setLegacyLoanType] = useState("");
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [editing, setEditing] = useState<Record<string, Partial<ScheduleRow>>>({});
  const [generateForm, setGenerateForm] = useState({ start_date: "", months: "", emi_amount: "", principal_total: "" });
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  const registerFieldRef = (name: string) => (node: HTMLInputElement | HTMLSelectElement | null) => {
    fieldRefs.current[name] = node;
  };

  const hasValidationErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);

  const withAuth = async () => {
    const session = await requireAuthRedirectHome(router as any);
    return session?.access_token ? session.access_token : null;
  };

  const loadLoan = async () => {
    if (!loanId) return;
    const token = await withAuth();
    if (!token) return;
    const res = await fetch(`/api/finance/loans/${loanId}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load loan");
    const nextLoan = json.data?.loan;
    setLoan(nextLoan);
    if (nextLoan) {
      setForm({
        loan_type: nextLoan.loan_type || "term_loan",
        lender_name: nextLoan.lender_name || "",
        disbursed_amount: nextLoan.disbursed_amount ?? 0,
        status: nextLoan.status || "active",
        loan_ref: nextLoan.loan_ref || "",
        interest_rate_annual: nextLoan.interest_rate_annual ?? "",
        tenure_months: nextLoan.tenure_months ?? "",
        emi_amount: nextLoan.emi_amount ?? "",
        notes: nextLoan.notes ?? null,
      });
      const known = LOAN_TYPE_OPTIONS.some((option) => option.value === nextLoan.loan_type);
      setLegacyLoanType(known ? "" : nextLoan.loan_type || "");
      setCustomLoanType(known ? "" : nextLoan.loan_type || "");
      setErrors(validateLoanForm({
        loan_type: nextLoan.loan_type || "term_loan",
        lender_name: nextLoan.lender_name || "",
        disbursed_amount: nextLoan.disbursed_amount ?? 0,
        status: nextLoan.status || "active",
        loan_ref: nextLoan.loan_ref || "",
        interest_rate_annual: nextLoan.interest_rate_annual ?? "",
        tenure_months: nextLoan.tenure_months ?? "",
        emi_amount: nextLoan.emi_amount ?? "",
      }));
    }
  };

  const loadSchedules = async () => {
    if (!loanId) return;
    const token = await withAuth();
    if (!token) return;
    const res = await fetch(`/api/finance/loans/${loanId}/schedules`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load schedules");
    setSchedules(json.data || []);
  };

  useEffect(() => {
    loadLoan();
    loadSchedules();
  }, [loanId]);

  const applyPatch = (patch: Partial<LoanFormValues>) => {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setErrors(validateLoanForm(next));
  };

  const save = async () => {
    if (!form || !loanId) return;
    setError("");
    const validationErrors = validateLoanForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return setError("Please fix highlighted fields before saving.");
    setSaving(true);
    try {
      const token = await withAuth();
      if (!token) return;
      const payload: LoanFormValues = {
        ...form,
        lender_name: form.lender_name.trim(),
        disbursed_amount: form.disbursed_amount === "" ? 0 : form.disbursed_amount,
      };
      if (form.loan_type === "other" && legacyLoanType && customLoanType.trim() === legacyLoanType.trim()) payload.loan_type = legacyLoanType;
      if (form.loan_type === "other") payload.notes = upsertCustomTypeNote(form.notes, customLoanType);

      const res = await fetch(`/api/finance/loans/${loanId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Failed to save");
      setLoan(json.data);
      setNotice("Loan updated.");
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!loanId) return;
    setError("");
    setNotice("");
    const token = await withAuth();
    if (!token) return;
    const res = await fetch(`/api/finance/loans/${loanId}/schedule/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(generateForm),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Schedule generation failed");
    setNotice(`Generated ${json.data?.inserted_count || 0} rows (skipped ${json.data?.skipped_count || 0}).`);
    await loadSchedules();
  };

  const editCell = (scheduleId: string, key: keyof ScheduleRow, value: any) => {
    setEditing((prev) => ({ ...prev, [scheduleId]: { ...prev[scheduleId], [key]: value } }));
  };

  const saveLine = async (row: ScheduleRow) => {
    const patch = editing[row.id] || {};
    const payload = {
      due_date: patch.due_date ?? row.due_date,
      emi_amount: patch.emi_amount ?? row.emi_amount,
      principal_component: patch.principal_component ?? row.principal_component,
      interest_component: patch.interest_component ?? row.interest_component,
      notes: patch.notes ?? row.notes,
    };
    const token = await withAuth();
    if (!token) return;
    const res = await fetch(`/api/finance/loans/schedules/${row.id}/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to update schedule line");
    setNotice(`Updated line ${row.line_no}.`);
    setEditing((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await loadSchedules();
  };

  const previewRow = async (scheduleId: string) => {
    const token = await withAuth();
    if (!token) return;
    const res = await fetch(`/api/finance/loans/schedules/${scheduleId}/preview`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Preview failed");
    setPreview({ scheduleId, ...json.data });
  };

  const postRow = async (scheduleId: string) => {
    const token = await withAuth();
    if (!token) return;
    setPostingId(scheduleId);
    setError("");
    try {
      const res = await fetch(`/api/finance/loans/schedules/${scheduleId}/post`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Post failed");
      setNotice(`Posted to journal ${json.data?.journal_no || json.data?.journal_id}.`);
      await loadSchedules();
    } finally {
      setPostingId(null);
    }
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title={loan?.lender_name || "Loan"}
          description="Loan details and EMI schedule."
          rightActions={<button style={secondaryButtonStyle} onClick={save} disabled={!form || saving || hasValidationErrors}>{saving ? "Saving…" : "Save Loan"}</button>}
        />
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {notice ? <p style={{ color: "#047857" }}>{notice}</p> : null}

        <div style={cardStyle}>{form ? <LoanForm form={form} errors={errors} customLoanType={customLoanType} onCustomLoanTypeChange={setCustomLoanType} onFormChange={applyPatch} legacyLoanType={legacyLoanType} registerFieldRef={registerFieldRef} /> : <p style={{ margin: 0, color: "#6b7280" }}>Loading loan details…</p>}</div>

        <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Schedule</h3>
            <Link href="/erp/finance/settings/loan-posting" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>Loan Posting Settings</Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8 }}>
            <input style={inputStyle} placeholder="Start date YYYY-MM-DD" value={generateForm.start_date} onChange={(e) => setGenerateForm((p) => ({ ...p, start_date: e.target.value }))} />
            <input style={inputStyle} placeholder="Months" value={generateForm.months} onChange={(e) => setGenerateForm((p) => ({ ...p, months: e.target.value }))} />
            <input style={inputStyle} placeholder="EMI amount" value={generateForm.emi_amount} onChange={(e) => setGenerateForm((p) => ({ ...p, emi_amount: e.target.value }))} />
            <input style={inputStyle} placeholder="Principal total (optional)" value={generateForm.principal_total} onChange={(e) => setGenerateForm((p) => ({ ...p, principal_total: e.target.value }))} />
            <button style={secondaryButtonStyle} onClick={generate}>Generate</button>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Line</th>
                <th style={tableHeaderCellStyle}>Due</th>
                <th style={tableHeaderCellStyle}>EMI</th>
                <th style={tableHeaderCellStyle}>Principal</th>
                <th style={tableHeaderCellStyle}>Interest</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Journal</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((row) => {
                const patch = editing[row.id] || {};
                const emi = Number((patch.emi_amount ?? row.emi_amount) || 0);
                const principal = Number((patch.principal_component ?? row.principal_component) || 0);
                const interest = Number((patch.interest_component ?? row.interest_component) || 0);
                const splitOk = Math.abs(emi - (principal + interest)) <= 0.01 && emi > 0;
                return (
                  <tr key={row.id}>
                    <td style={tableCellStyle}>{row.line_no}</td>
                    <td style={tableCellStyle}><input style={inputStyle} value={(patch.due_date as string) ?? row.due_date} onChange={(e) => editCell(row.id, "due_date", e.target.value)} /></td>
                    <td style={tableCellStyle}><input style={inputStyle} value={String((patch.emi_amount as any) ?? row.emi_amount)} onChange={(e) => editCell(row.id, "emi_amount", Number(e.target.value || 0))} /></td>
                    <td style={tableCellStyle}><input style={inputStyle} value={String((patch.principal_component as any) ?? row.principal_component)} onChange={(e) => editCell(row.id, "principal_component", Number(e.target.value || 0))} /></td>
                    <td style={tableCellStyle}><input style={inputStyle} value={String((patch.interest_component as any) ?? row.interest_component)} onChange={(e) => editCell(row.id, "interest_component", Number(e.target.value || 0))} /></td>
                    <td style={tableCellStyle}>{row.status}</td>
                    <td style={tableCellStyle}>{row.journal_no || "—"}</td>
                    <td style={tableCellStyle}>
                      <button style={secondaryButtonStyle} onClick={() => saveLine(row)}>Save</button>{" "}
                      <button style={secondaryButtonStyle} onClick={() => previewRow(row.id)}>Preview</button>{" "}
                      <button style={{ ...secondaryButtonStyle, opacity: splitOk ? 1 : 0.5 }} disabled={!splitOk || postingId === row.id} onClick={() => postRow(row.id)}>{postingId === row.id ? "Posting…" : "Post"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {preview ? (
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h4 style={{ margin: 0 }}>Preview for schedule {preview.scheduleId}</h4>
              <button style={secondaryButtonStyle} onClick={() => setPreview(null)}>Close</button>
            </div>
            <p style={{ color: preview.can_post ? "#047857" : "#b45309" }}>Can post: {String(preview.can_post)}</p>
            {(preview.warnings || []).length ? <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview.warnings, null, 2)}</pre> : null}
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview.lines || [], null, 2)}</pre>
          </div>
        ) : null}
      </div>
    </ErpShell>
  );
}
