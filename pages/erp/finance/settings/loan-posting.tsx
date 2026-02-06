import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, inputStyle, pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";


const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#374151" } as const;

export default function LoanPostingSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<any>({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router as any);
      if (!session) return;
      const res = await fetch("/api/erp/finance/loan-posting-config", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (res.ok) setForm(json.data || {});
    })();
  }, [router]);

  const save = async () => {
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch("/api/erp/finance/loan-posting-config", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(form) });
    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Failed to save");
    setMsg("Saved");
  };

  return <ErpShell activeModule="finance"><div style={pageContainerStyle}><ErpPageHeader eyebrow="Finance Settings" title="Loan Posting Config" description="Configure COA mappings for loan EMI posting." rightActions={<button style={secondaryButtonStyle} onClick={save}>Save</button>} />
    <div style={cardStyle}><div style={{ display: "flex", gap: 8, marginBottom: 10 }}><Link href="/erp/finance/masters/gl-accounts" style={secondaryButtonStyle}>Open Chart of Accounts</Link></div>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={labelStyle}>Loan Principal Account ID<input style={inputStyle} value={form.loan_principal_account_id || ""} onChange={(e) => setForm({ ...form, loan_principal_account_id: e.target.value })} /></label>
        <label style={labelStyle}>Interest Expense Account ID<input style={inputStyle} value={form.interest_expense_account_id || ""} onChange={(e) => setForm({ ...form, interest_expense_account_id: e.target.value })} /></label>
        <label style={labelStyle}>Bank Account ID<input style={inputStyle} value={form.bank_account_id || ""} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })} /></label>
      </div>
      {msg ? <p>{msg}</p> : null}
    </div></div></ErpShell>;
}
