import { useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
} from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";

const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#374151" } as const;
const helperStyle = { margin: 0, fontSize: 12, color: "#6b7280" } as const;

type LoanForm = {
  loan_type: string;
  lender_name: string;
  disbursed_amount: number;
  status: string;
  loan_ref?: string;
  interest_rate_annual?: number | "";
  tenure_months?: number | "";
  emi_amount?: number | "";
};

export default function NewLoanPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoanForm>({
    loan_type: "term_loan",
    lender_name: "",
    disbursed_amount: 0,
    status: "active",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const validate = () => {
    if (!form.lender_name.trim()) return "Lender is required.";
    if (Number.isNaN(form.disbursed_amount) || form.disbursed_amount < 0) {
      return "Disbursed amount must be a number greater than or equal to 0.";
    }
    if (form.interest_rate_annual !== "" && form.interest_rate_annual !== undefined) {
      if (Number.isNaN(Number(form.interest_rate_annual)) || Number(form.interest_rate_annual) < 0 || Number(form.interest_rate_annual) > 60) {
        return "Interest % must be between 0 and 60.";
      }
    }
    if (form.tenure_months !== "" && form.tenure_months !== undefined) {
      if (Number.isNaN(Number(form.tenure_months)) || Number(form.tenure_months) < 1 || Number(form.tenure_months) > 600) {
        return "Tenure months must be between 1 and 600.";
      }
    }
    if (form.emi_amount !== "" && form.emi_amount !== undefined) {
      if (Number.isNaN(Number(form.emi_amount)) || Number(form.emi_amount) < 0) {
        return "EMI amount must be greater than or equal to 0.";
      }
    }
    return "";
  };

  const save = async () => {
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const session = await requireAuthRedirectHome(router as any);
      if (!session) return;

      const payload = {
        ...form,
        lender_name: form.lender_name.trim(),
      };

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
            <button type="button" style={secondaryButtonStyle} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          }
        />
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <div style={cardStyle}>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={labelStyle}>
              Lender
              <input
                style={inputStyle}
                value={form.lender_name}
                onChange={(e) => setForm({ ...form, lender_name: e.target.value })}
              />
            </label>
            <label style={labelStyle}>
              Loan Type
              <input
                style={inputStyle}
                value={form.loan_type}
                onChange={(e) => setForm({ ...form, loan_type: e.target.value })}
              />
              <p style={helperStyle}>
                Supports all loan types like term loan, revenue-based financing (RBF), overdraft, and custom facilities.
              </p>
            </label>
            <label style={labelStyle}>
              Loan Ref
              <input
                style={inputStyle}
                value={form.loan_ref || ""}
                onChange={(e) => setForm({ ...form, loan_ref: e.target.value })}
              />
            </label>
            <label style={labelStyle}>
              Disbursed Amount
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={form.disbursed_amount}
                onChange={(e) => setForm({ ...form, disbursed_amount: Number(e.target.value) })}
              />
            </label>
            <label style={labelStyle}>
              Interest % (annual)
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={60}
                value={form.interest_rate_annual || ""}
                onChange={(e) =>
                  setForm({ ...form, interest_rate_annual: e.target.value === "" ? "" : Number(e.target.value) })
                }
              />
            </label>
            <label style={labelStyle}>
              Tenure Months
              <input
                style={inputStyle}
                type="number"
                min={1}
                max={600}
                value={form.tenure_months || ""}
                onChange={(e) =>
                  setForm({ ...form, tenure_months: e.target.value === "" ? "" : Number(e.target.value) })
                }
              />
            </label>
            <label style={labelStyle}>
              EMI Amount
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={form.emi_amount || ""}
                onChange={(e) =>
                  setForm({ ...form, emi_amount: e.target.value === "" ? "" : Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
      </div>
    </ErpShell>
  );
}
