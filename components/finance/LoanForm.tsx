import { inputStyle } from "../erp/uiStyles";

const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#374151" } as const;
const helperStyle = { margin: 0, fontSize: 12, color: "#6b7280" } as const;
const errorStyle = { margin: 0, fontSize: 12, color: "#b91c1c" } as const;

export const LOAN_TYPE_OPTIONS = [
  { value: "term_loan", label: "Term loan (EMI)" },
  { value: "working_capital", label: "Working capital / OD / CC" },
  { value: "rbf", label: "RBF (Revenue Based Finance)" },
  { value: "vendor_credit", label: "Vendor credit" },
  { value: "equipment_loan", label: "Equipment / asset loan" },
  { value: "personal_loan", label: "Personal loan (company-paid)" },
  { value: "other", label: "Other (custom)" },
] as const;

export type LoanFormValues = {
  loan_type: string;
  lender_name: string;
  disbursed_amount: number | "";
  status: string;
  loan_ref?: string;
  interest_rate_annual?: number | "";
  tenure_months?: number | "";
  emi_amount?: number | "";
  notes?: string | null;
};

export type LoanFormErrors = Partial<
  Record<"lender_name" | "disbursed_amount" | "interest_rate_annual" | "tenure_months" | "emi_amount", string>
>;

export const validateLoanForm = (form: LoanFormValues): LoanFormErrors => {
  const errors: LoanFormErrors = {};

  if (!form.lender_name.trim()) errors.lender_name = "Lender is required.";

  if (form.disbursed_amount !== "") {
    const value = Number(form.disbursed_amount);
    if (Number.isNaN(value) || value < 0) {
      errors.disbursed_amount = "Disbursed amount must be a number greater than or equal to 0.";
    }
  }

  if (form.interest_rate_annual !== "" && form.interest_rate_annual !== undefined) {
    const value = Number(form.interest_rate_annual);
    if (Number.isNaN(value) || value < 0 || value > 60) {
      errors.interest_rate_annual = "Interest % must be between 0 and 60.";
    }
  }

  if (form.tenure_months !== "" && form.tenure_months !== undefined) {
    const value = Number(form.tenure_months);
    if (!Number.isInteger(value) || value < 1 || value > 600) {
      errors.tenure_months = "Tenure months must be an integer between 1 and 600.";
    }
  }

  if (form.emi_amount !== "" && form.emi_amount !== undefined) {
    const value = Number(form.emi_amount);
    if (Number.isNaN(value) || value < 0) {
      errors.emi_amount = "EMI amount must be greater than or equal to 0.";
    }
  }

  return errors;
};

type Props = {
  form: LoanFormValues;
  errors: LoanFormErrors;
  customLoanType: string;
  onFormChange: (patch: Partial<LoanFormValues>) => void;
  onCustomLoanTypeChange: (value: string) => void;
  legacyLoanType?: string;
  registerFieldRef?: (name: string) => (node: HTMLInputElement | HTMLSelectElement | null) => void;
};

export default function LoanForm({
  form,
  errors,
  customLoanType,
  onFormChange,
  onCustomLoanTypeChange,
  legacyLoanType,
  registerFieldRef,
}: Props) {
  const hasKnownLoanType = LOAN_TYPE_OPTIONS.some((option) => option.value === form.loan_type);
  const selectedLoanType = hasKnownLoanType ? form.loan_type : "other";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label style={labelStyle}>
        Lender
        <input
          ref={registerFieldRef?.("lender_name")}
          style={inputStyle}
          value={form.lender_name}
          onChange={(e) => onFormChange({ lender_name: e.target.value })}
        />
        {errors.lender_name ? <p style={errorStyle}>{errors.lender_name}</p> : null}
      </label>

      <label style={labelStyle}>
        Loan Type
        <select
          style={inputStyle}
          value={selectedLoanType}
          onChange={(e) => onFormChange({ loan_type: e.target.value })}
        >
          {LOAN_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p style={helperStyle}>Choose closest; use ‘Other’ for custom.</p>
      </label>

      {selectedLoanType === "other" ? (
        <label style={labelStyle}>
          Custom type
          <input
            style={inputStyle}
            value={customLoanType}
            onChange={(e) => onCustomLoanTypeChange(e.target.value)}
            placeholder="Optional custom loan type"
          />
          {legacyLoanType ? <p style={helperStyle}>Legacy type currently saved: {legacyLoanType}</p> : null}
        </label>
      ) : null}

      <label style={labelStyle}>
        Loan Ref
        <input style={inputStyle} value={form.loan_ref || ""} onChange={(e) => onFormChange({ loan_ref: e.target.value })} />
      </label>

      <label style={labelStyle}>
        Disbursed Amount
        <input
          ref={registerFieldRef?.("disbursed_amount")}
          style={inputStyle}
          type="number"
          min={0}
          value={form.disbursed_amount}
          onChange={(e) => onFormChange({ disbursed_amount: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        {errors.disbursed_amount ? <p style={errorStyle}>{errors.disbursed_amount}</p> : null}
      </label>

      <label style={labelStyle}>
        Interest % (annual)
        <input
          ref={registerFieldRef?.("interest_rate_annual")}
          style={inputStyle}
          type="number"
          min={0}
          max={60}
          value={form.interest_rate_annual || ""}
          onChange={(e) => onFormChange({ interest_rate_annual: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        {errors.interest_rate_annual ? <p style={errorStyle}>{errors.interest_rate_annual}</p> : null}
      </label>

      <label style={labelStyle}>
        Tenure Months
        <input
          ref={registerFieldRef?.("tenure_months")}
          style={inputStyle}
          type="number"
          min={1}
          max={600}
          value={form.tenure_months || ""}
          onChange={(e) => onFormChange({ tenure_months: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        {errors.tenure_months ? <p style={errorStyle}>{errors.tenure_months}</p> : null}
      </label>

      <label style={labelStyle}>
        EMI Amount
        <input
          ref={registerFieldRef?.("emi_amount")}
          style={inputStyle}
          type="number"
          min={0}
          value={form.emi_amount || ""}
          onChange={(e) => onFormChange({ emi_amount: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        {errors.emi_amount ? <p style={errorStyle}>{errors.emi_amount}</p> : null}
      </label>
    </div>
  );
}

const CUSTOM_TYPE_PREFIX = "[Loan Type Custom] ";

export const upsertCustomTypeNote = (notes: string | null | undefined, customType: string) => {
  const base = (notes || "")
    .split("\n")
    .filter((line) => !line.startsWith(CUSTOM_TYPE_PREFIX))
    .join("\n")
    .trim();

  if (!customType.trim()) return base || null;

  const customLine = `${CUSTOM_TYPE_PREFIX}${customType.trim()}`;
  return base ? `${base}\n${customLine}` : customLine;
};
