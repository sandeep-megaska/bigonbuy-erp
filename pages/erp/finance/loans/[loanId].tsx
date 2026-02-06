import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, secondaryButtonStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";
import LoanForm, { LoanFormErrors, LoanFormValues, LOAN_TYPE_OPTIONS, upsertCustomTypeNote, validateLoanForm } from "../../../../components/finance/LoanForm";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function LoanDetailPage() {
  const router = useRouter();
  const loanId = first(router.query.loanId);
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<LoanFormValues | null>(null);
  const [customLoanType, setCustomLoanType] = useState("");
  const [legacyLoanType, setLegacyLoanType] = useState("");
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  const registerFieldRef = (name: string) => (node: HTMLInputElement | HTMLSelectElement | null) => {
    fieldRefs.current[name] = node;
  };

  const hasValidationErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);

  const load = async () => {
    if (!loanId) return;
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch(`/api/erp/finance/loans/${loanId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    const loan = json.data?.loan;
    setData(json.data);
    if (loan) {
      setForm({
        loan_type: loan.loan_type || "term_loan",
        lender_name: loan.lender_name || "",
        disbursed_amount: loan.disbursed_amount ?? 0,
        status: loan.status || "active",
        loan_ref: loan.loan_ref || "",
        interest_rate_annual: loan.interest_rate_annual ?? "",
        tenure_months: loan.tenure_months ?? "",
        emi_amount: loan.emi_amount ?? "",
        notes: loan.notes ?? null,
      });
      const known = LOAN_TYPE_OPTIONS.some((option) => option.value === loan.loan_type);
      setLegacyLoanType(known ? "" : loan.loan_type || "");
      setCustomLoanType(known ? "" : loan.loan_type || "");
      setErrors(validateLoanForm({
        loan_type: loan.loan_type || "term_loan",
        lender_name: loan.lender_name || "",
        disbursed_amount: loan.disbursed_amount ?? 0,
        status: loan.status || "active",
        loan_ref: loan.loan_ref || "",
        interest_rate_annual: loan.interest_rate_annual ?? "",
        tenure_months: loan.tenure_months ?? "",
        emi_amount: loan.emi_amount ?? "",
      }));
    }
  };

  useEffect(() => {
    load();
  }, [loanId]);

  const applyPatch = (patch: Partial<LoanFormValues>) => {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setErrors(validateLoanForm(next));
  };

  const focusFirstInvalid = (nextErrors: LoanFormErrors) => {
    const order: (keyof LoanFormErrors)[] = ["lender_name", "disbursed_amount", "interest_rate_annual", "tenure_months", "emi_amount"];
    const firstInvalid = order.find((key) => Boolean(nextErrors[key]));
    if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
  };

  const save = async () => {
    if (!form || !loanId) return;
    setError("");

    const validationErrors = validateLoanForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError("Please fix the highlighted errors before saving.");
      focusFirstInvalid(validationErrors);
      return;
    }

    setSaving(true);
    try {
      const session = await requireAuthRedirectHome(router as any);
      if (!session) return;

      const payload: LoanFormValues = {
        ...form,
        lender_name: form.lender_name.trim(),
        disbursed_amount: form.disbursed_amount === "" ? 0 : form.disbursed_amount,
      };

      if (form.loan_type === "other" && legacyLoanType && customLoanType.trim() === legacyLoanType.trim()) {
        payload.loan_type = legacyLoanType;
      }

      if (form.loan_type === "other") {
        payload.notes = upsertCustomTypeNote(form.notes, customLoanType);
      }

      const res = await fetch(`/api/erp/finance/loans/${loanId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to save");
        return;
      }
      setData((prev: any) => ({ ...prev, loan: json.data }));
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    const start = prompt("Start date (YYYY-MM-DD)");
    const months = prompt("Months");
    if (!start || !months) return;
    const session = await requireAuthRedirectHome(router as any);
    if (!session || !loanId) return;
    await fetch(`/api/erp/finance/loans/${loanId}/schedule/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ start_date: start, months: Number(months) }),
    });
    load();
  };

  const preview = async (scheduleId: string) => {
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch(`/api/erp/finance/loans/schedules/${scheduleId}/preview`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await res.json();
    alert(JSON.stringify(json.data, null, 2));
  };

  const post = async (scheduleId: string) => {
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch(`/api/erp/finance/loans/schedules/${scheduleId}/post`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await res.json();
    if (!res.ok) return alert(json.error || "Failed to post");
    load();
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title={data?.loan?.lender_name || "Loan"}
          description="Loan details and EMI schedule."
          rightActions={
            <div style={{ display: "flex", gap: 8 }}>
              <button style={secondaryButtonStyle} onClick={generate}>Generate EMI Schedule</button>
              <button style={secondaryButtonStyle} onClick={save} disabled={!form || saving || hasValidationErrors}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          }
        />
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <div style={cardStyle}>
          {form ? (
            <LoanForm
              form={form}
              errors={errors}
              customLoanType={customLoanType}
              onCustomLoanTypeChange={setCustomLoanType}
              onFormChange={applyPatch}
              legacyLoanType={legacyLoanType}
              registerFieldRef={registerFieldRef}
            />
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>Loading loan details…</p>
          )}
        </div>

        <div style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Due</th>
                <th style={tableHeaderCellStyle}>EMI</th>
                <th style={tableHeaderCellStyle}>Principal</th>
                <th style={tableHeaderCellStyle}>Interest</th>
                <th style={tableHeaderCellStyle}>Posted Journal</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.schedules || []).map((s: any) => (
                <tr key={s.id}>
                  <td style={tableCellStyle}>{s.due_date}</td>
                  <td style={tableCellStyle}>{s.emi_amount}</td>
                  <td style={tableCellStyle}>{s.principal_component}</td>
                  <td style={tableCellStyle}>{s.interest_component}</td>
                  <td style={tableCellStyle}>{s.erp_loan_finance_posts?.[0]?.erp_fin_journals?.doc_no || "—"}</td>
                  <td style={tableCellStyle}>
                    <button style={secondaryButtonStyle} onClick={() => preview(s.id)}>Preview</button>{" "}
                    <button style={secondaryButtonStyle} onClick={() => post(s.id)}>Post to Finance</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ErpShell>
  );
}
