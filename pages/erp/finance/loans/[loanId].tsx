import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, secondaryButtonStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";

export default function LoanDetailPage() {
  const router = useRouter();
  const { loanId } = router.query;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (!loanId) return;
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    const res = await fetch(`/api/erp/finance/loans/${loanId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to load");
    setData(json.data);
  };

  useEffect(() => { load(); }, [loanId]);

  const generate = async () => {
    const start = prompt("Start date (YYYY-MM-DD)");
    const months = prompt("Months");
    if (!start || !months) return;
    const session = await requireAuthRedirectHome(router as any);
    if (!session) return;
    await fetch(`/api/erp/finance/loans/${loanId}/schedule/generate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ start_date: start, months: Number(months) }) });
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

  return <ErpShell activeModule="finance"><div style={pageContainerStyle}><ErpPageHeader eyebrow="Finance" title={data?.loan?.lender_name || "Loan"} description="Loan details and EMI schedule." rightActions={<button style={secondaryButtonStyle} onClick={generate}>Generate EMI Schedule</button>} />
    {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
    <div style={cardStyle}><table style={tableStyle}><thead><tr><th style={tableHeaderCellStyle}>Due</th><th style={tableHeaderCellStyle}>EMI</th><th style={tableHeaderCellStyle}>Principal</th><th style={tableHeaderCellStyle}>Interest</th><th style={tableHeaderCellStyle}>Posted Journal</th><th style={tableHeaderCellStyle}>Actions</th></tr></thead>
      <tbody>{(data?.schedules || []).map((s: any) => <tr key={s.id}><td style={tableCellStyle}>{s.due_date}</td><td style={tableCellStyle}>{s.emi_amount}</td><td style={tableCellStyle}>{s.principal_component}</td><td style={tableCellStyle}>{s.interest_component}</td><td style={tableCellStyle}>{s.erp_loan_finance_posts?.[0]?.erp_fin_journals?.doc_no || "—"}</td><td style={tableCellStyle}><button style={secondaryButtonStyle} onClick={() => preview(s.id)}>Preview</button> <button style={secondaryButtonStyle} onClick={() => post(s.id)}>Post to Finance</button></td></tr>)}</tbody></table></div></div></ErpShell>;
}
