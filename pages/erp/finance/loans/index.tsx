import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, secondaryButtonStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";

export default function LoanListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router as any);
      if (!session) return;
      const res = await fetch("/api/erp/finance/loans", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Failed to load loans");
      setRows(json.data || []);
    })();
  }, [router]);

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader eyebrow="Finance" title="Loans" description="Loan masters and EMI schedules." rightActions={<Link href="/erp/finance/loans/new" style={secondaryButtonStyle}>New Loan</Link>} />
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <div style={cardStyle}>
          <table style={tableStyle}><thead><tr><th style={tableHeaderCellStyle}>Lender</th><th style={tableHeaderCellStyle}>Type</th><th style={tableHeaderCellStyle}>Ref</th><th style={tableHeaderCellStyle}>EMI</th><th style={tableHeaderCellStyle}>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td style={tableCellStyle}><Link href={`/erp/finance/loans/${r.id}`}>{r.lender_name}</Link></td><td style={tableCellStyle}>{r.loan_type}</td><td style={tableCellStyle}>{r.loan_ref || "—"}</td><td style={tableCellStyle}>{r.emi_amount ?? "—"}</td><td style={tableCellStyle}>{r.status}</td></tr>)}</tbody></table>
        </div>
      </div>
    </ErpShell>
  );
}
