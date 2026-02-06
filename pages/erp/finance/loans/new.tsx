import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";
import LoanForm, { LoanFormErrors, LoanFormValues, upsertCustomTypeNote, validateLoanForm } from "../../../../components/finance/LoanForm";

export default function NewLoanPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoanFormValues>({
    loan_type: "term_loan",
    lender_name: "",
    disbursed_amount: 0,
    status: "active",
    notes: null,
  });
  const [customLoanType, setCustomLoanType] = useState("");
  const [errors, setErrors] = useState<LoanFormErrors>({ lender_name: "Lender is required." });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  const registerFieldRef = (name: string) => (node: HTMLInputElement | HTMLSelectElement | null) => {
    fieldRefs.current[name] = node;
  };

  const hasValidationErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);

  const applyPatch = (patch: Partial<LoanFormValues>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setErrors(validateLoanForm(next));
  };

  const focusFirstInvalid = (nextErrors: LoanFormErrors) => {
    const order: (keyof LoanFormErrors)[] = ["lender_name", "disbursed_amount", "interest_rate_annual", "tenure_months", "emi_amount"];
    const first = order.find((key) => Boolean(nextErrors[key]));
    if (first) fieldRefs.current[first]?.focus();
  };

  const save = async () => {
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

      const payload = {
        ...form,
        lender_name: form.lender_name.trim(),
        disbursed_amount: form.disbursed_amount === "" ? 0 : form.disbursed_amount,
      };

      if (form.loan_type === "other") {
        payload.notes = upsertCustomTypeNote(form.notes, customLoanType);
      }

      const res = await fetch("/api/erp/finance/loans", {
        method: "POST",
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
      router.push(`/erp/finance/loans/${json.data.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="New Loan"
          description="Create a loan master."
          rightActions={
            <button type="button" style={secondaryButtonStyle} onClick={save} disabled={saving || hasValidationErrors}>
              {saving ? "Saving…" : "Save"}
            </button>
          }
        />
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <div style={cardStyle}>
          <LoanForm
            form={form}
            errors={errors}
            customLoanType={customLoanType}
            onCustomLoanTypeChange={setCustomLoanType}
            onFormChange={applyPatch}
            registerFieldRef={registerFieldRef}
          />
        </div>
      </div>
    </ErpShell>
  );
}
