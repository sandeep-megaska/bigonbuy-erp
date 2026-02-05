import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { badgeStyle, cardStyle, inputStyle, pageContainerStyle, primaryButtonStyle, secondaryButtonStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { amazonSettlementStage1ListSchema, amazonSettlementStage1PreviewSchema, amazonSettlementStage1SummarySchema } from "../../../../lib/erp/amazonSettlementStage1Posting";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const formatLocalDate = (date: Date) => date.toLocaleDateString("en-CA");
const today = () => formatLocalDate(new Date());
const startOfPreviousMonth = () => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
};

type Filter = "all" | "posted" | "missing" | "excluded";

export default function AmazonSettlementSalesPostingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{ companyId: string | null; roleKey: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(startOfPreviousMonth());
  const [toDate, setToDate] = useState(today());
  const [postingFilter, setPostingFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<z.infer<typeof amazonSettlementStage1ListSchema>>([]);
  const [summary, setSummary] = useState<z.infer<typeof amazonSettlementStage1SummarySchema> | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof amazonSettlementStage1PreviewSchema>>([]);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [postingBatchId, setPostingBatchId] = useState<string | null>(null);

  const canWrite = useMemo(() => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)), [ctx]);

  const loadSummary = async (from: string, to: string) => {
    const response = await fetch(`/api/erp/finance/amazon/settlements/summary?from=${from}&to=${to}`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load summary");
    const parsed = amazonSettlementStage1SummarySchema.safeParse(Array.isArray(payload.data) ? payload.data[0] : payload.data);
    if (!parsed.success) throw new Error("Failed to parse summary");
    setSummary(parsed.data);
  };

  const loadRows = async (from = fromDate, to = toDate, status = postingFilter) => {
    const response = await fetch(`/api/erp/finance/amazon/settlements/list?from=${from}&to=${to}&status=${status}`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load settlement list");
    const parsed = amazonSettlementStage1ListSchema.safeParse(payload.data);
    if (!parsed.success) throw new Error("Failed to parse settlement list");
    setRows(parsed.data);
  };

  const loadPreview = async (batchId: string) => {
    setPreviewBatchId(batchId);
    const response = await fetch(`/api/erp/finance/amazon/settlements/${batchId}/preview`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load journal preview");
    const parsed = amazonSettlementStage1PreviewSchema.safeParse(payload.data);
    if (!parsed.success) throw new Error("Failed to parse preview");
    setPreview(parsed.data);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const companyContext = await getCompanyContext(session);
      if (!active) return;
      setCtx({ companyId: companyContext.companyId, roleKey: companyContext.roleKey });
      if (!companyContext.companyId) {
        setError(companyContext.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }
      try {
        await Promise.all([loadRows(), loadSummary(fromDate, toDate)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router.isReady]);

  const handlePost = async (batchId: string) => {
    if (!canWrite) return;
    if (!window.confirm("Post this Amazon settlement to finance?")) return;
    setPostingBatchId(batchId);
    try {
      const response = await fetch(`/api/erp/finance/amazon/settlements/${batchId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Posting failed");
      await Promise.all([loadRows(), loadSummary(fromDate, toDate), loadPreview(batchId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Posting failed");
    } finally {
      setPostingBatchId(null);
    }
  };

  if (loading) return <div style={pageContainerStyle}>Loading Amazon settlement posting…</div>;

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader eyebrow="Finance" title="Amazon Settlement Posting" description="Settlement-level posting from normalized Amazon settlement ledger." />

        <section style={{ ...cardStyle, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} /></div>
          <div><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} /></div>
          <button style={primaryButtonStyle} onClick={() => void Promise.all([loadRows(fromDate, toDate), loadSummary(fromDate, toDate)])}>Apply filters</button>
        </section>

        <section style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {(["all", "posted", "missing", "excluded"] as Filter[]).map((option) => (
            <button key={option} style={secondaryButtonStyle} onClick={() => { setPostingFilter(option); void loadRows(fromDate, toDate, option); }}>
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Posting coverage</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>Total: {summary?.total_count ?? 0}</div>
            <div>Posted: {summary?.posted_count ?? 0}</div>
            <div>Missing: {summary?.missing_count ?? 0}</div>
            <div>Excluded: {summary?.excluded_count ?? 0}</div>
          </div>
        </section>

        {error ? <div style={{ ...cardStyle, color: "#b91c1c", marginBottom: 16 }}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead><tr><th style={tableHeaderCellStyle}>Settlement</th><th style={tableHeaderCellStyle}>Deposit date</th><th style={tableHeaderCellStyle}>Period</th><th style={tableHeaderCellStyle}>Net payout</th><th style={tableHeaderCellStyle}>State</th><th style={tableHeaderCellStyle}>Journal</th><th style={tableHeaderCellStyle}>Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.batch_id}>
                  <td style={tableCellStyle}>{row.batch_ref || row.batch_id}</td>
                  <td style={tableCellStyle}>{row.deposit_date || "—"}</td>
                  <td style={tableCellStyle}>{row.settlement_start_date || "—"} → {row.settlement_end_date || "—"}</td>
                  <td style={tableCellStyle}>₹{Number(row.net_payout || 0).toFixed(2)}</td>
                  <td style={tableCellStyle}><span style={badgeStyle}>{row.posting_state || "missing"}</span></td>
                  <td style={tableCellStyle}>{row.journal_id ? <Link href={`/erp/finance/journals/${row.journal_id}`}>{row.journal_no || "View"}</Link> : "—"}</td>
                  <td style={tableCellStyle}>
                    <button style={secondaryButtonStyle} onClick={() => void loadPreview(row.batch_id)}>Preview</button>{" "}
                    <button style={primaryButtonStyle} disabled={!canWrite || postingBatchId === row.batch_id} onClick={() => void handlePost(row.batch_id)}>{postingBatchId === row.batch_id ? "Posting…" : "Post to Finance"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {previewBatchId ? (
            <div style={{ marginTop: 16 }}>
              <h3>Journal preview</h3>
              {preview[0]?.warnings?.length ? <ul>{preview[0].warnings?.map((w) => <li key={w}>{w}</li>)}</ul> : null}
              <table style={tableStyle}>
                <thead><tr><th style={tableHeaderCellStyle}>Role</th><th style={tableHeaderCellStyle}>Account</th><th style={tableHeaderCellStyle}>Debit</th><th style={tableHeaderCellStyle}>Credit</th></tr></thead>
                <tbody>
                  {preview.map((line, idx) => (
                    <tr key={`${line.role}-${idx}`}>
                      <td style={tableCellStyle}>{line.role}</td>
                      <td style={tableCellStyle}>{line.account_name || "—"}</td>
                      <td style={tableCellStyle}>₹{line.debit.toFixed(2)}</td>
                      <td style={tableCellStyle}>₹{line.credit.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}
