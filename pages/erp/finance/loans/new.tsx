import { useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, inputStyle, pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";


const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#374151" } as const;

export default function NewLoanPage() {
  const router = useRouter();
  const [form, setForm] = useState<any>({ loan_type: "term_loan", lender_name: "", disbursed_amount: 0, status: "active" });
  const [error, setError] = useState("");

  const save = async () => {
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch("/api/erp/finance/loans", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(form) });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to save");
    router.push(`/erp/finance/loans/${json.data.id}`);
  };

  return <ErpShell activeModule="finance"><div style={pageContainerStyle}><ErpPageHeader eyebrow="Finance" title="New Loan" description="Create a loan master." rightActions={<button style={secondaryButtonStyle} onClick={save}>Save</button>} />
    {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
    <div style={cardStyle}><div style={{ display: "grid", gap: 10 }}>
      <label style={labelStyle}>Lender<input style={inputStyle} value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} /></label>
      <label style={labelStyle}>Loan Type<input style={inputStyle} value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })} /></label>
      <label style={labelStyle}>Loan Ref<input style={inputStyle} value={form.loan_ref || ""} onChange={(e) => setForm({ ...form, loan_ref: e.target.value })} /></label>
      <label style={labelStyle}>Disbursed Amount<input style={inputStyle} type="number" value={form.disbursed_amount} onChange={(e) => setForm({ ...form, disbursed_amount: Number(e.target.value) })} /></label>
      <label style={labelStyle}>Interest % (annual)<input style={inputStyle} type="number" value={form.interest_rate_annual || ""} onChange={(e) => setForm({ ...form, interest_rate_annual: Number(e.target.value) })} /></label>
      <label style={labelStyle}>Tenure Months<input style={inputStyle} type="number" value={form.tenure_months || ""} onChange={(e) => setForm({ ...form, tenure_months: Number(e.target.value) })} /></label>
      <label style={labelStyle}>EMI Amount<input style={inputStyle} type="number" value={form.emi_amount || ""} onChange={(e) => setForm({ ...form, emi_amount: Number(e.target.value) })} /></label>
    </div></div></div></ErpShell>;
}
