import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { badgeStyle, cardStyle, inputStyle, pageContainerStyle, primaryButtonStyle, secondaryButtonStyle, subtitleStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { apiFetch } from "../../../../lib/erp/apiFetch";

type PayoutEventRow = {
  id: string;
  channel_code: string;
  payout_ref: string;
  payout_date: string;
  amount: number;
  currency: string;
  status: "unmatched" | "suggested" | "matched" | "posted" | "void";
  match_score: number | null;
  raw?: { suggested_bank_transaction_id?: string } | null;
};

type SuggestionRow = { event_id: string; bank_transaction_id: string; score: number; reason: string };

const last30 = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
};

export default function PayoutReconPage() {
  const router = useRouter();
  const defaults = useMemo(() => last30(), []);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [tab, setTab] = useState<"all" | "amazon" | "razorpay">("all");
  const [rows, setRows] = useState<PayoutEventRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const channel = tab === "all" ? "" : `&channel_code=${tab}`;
      const response = await apiFetch(`/api/finance/recon/payout-events?from=${fromDate}&to=${toDate}${channel}`, { method: "GET" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load payout events");
      setRows(payload.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payout events");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const ctx = await getCompanyContext(session);
      if (!active) return;
      if (!ctx.companyId) {
        setError("No active company membership found.");
        setLoading(false);
        return;
      }
      await load();
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const runAction = async (action: "import_amazon" | "import_razorpay" | "suggest") => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/finance/recon/payout-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, from: fromDate, to: toDate }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Failed to ${action}`);
      if (action === "suggest") setSuggestions(payload.data || []);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const linkEvent = async (eventId: string, bankTxnId: string, score: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/finance/recon/payout-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", event_id: eventId, bank_transaction_id: bankTxnId, score }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to link payout event");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link payout event");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader title="Payout Reconciliation" description="Unified payout events for Amazon and Razorpay" />
        <div style={{ ...cardStyle, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div><label>From</label><input style={inputStyle} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><label>To</label><input style={inputStyle} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <button style={secondaryButtonStyle} onClick={() => void load()} disabled={busy}>Refresh</button>
          <button style={primaryButtonStyle} onClick={() => void runAction("import_amazon")} disabled={busy}>Import Amazon</button>
          <button style={primaryButtonStyle} onClick={() => void runAction("import_razorpay")} disabled={busy}>Import Razorpay</button>
          <button style={primaryButtonStyle} onClick={() => void runAction("suggest")} disabled={busy}>Suggest matches</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {(["all", "amazon", "razorpay"] as const).map((item) => (
            <button key={item} style={item === tab ? primaryButtonStyle : secondaryButtonStyle} onClick={() => setTab(item)}>{item.toUpperCase()}</button>
          ))}
        </div>

        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

        <div style={{ ...cardStyle, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Suggested matches queue</h2>
            <span style={badgeStyle}>{suggestions.length}</span>
          </div>
          <p style={subtitleStyle}>Run suggestions and link from recommendations.</p>
          {suggestions.map((s) => (
            <div key={`${s.event_id}-${s.bank_transaction_id}`} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <code>{s.event_id}</code>
              <span>→</span>
              <code>{s.bank_transaction_id}</code>
              <span>score {s.score}</span>
              <span>{s.reason}</span>
              <button style={secondaryButtonStyle} onClick={() => void linkEvent(s.event_id, s.bank_transaction_id, s.score)} disabled={busy}>Link</button>
            </div>
          ))}
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Channel</th>
                <th style={tableHeaderCellStyle}>Payout ref</th>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading || busy ? <tr><td style={tableCellStyle} colSpan={6}>Loading…</td></tr> : null}
              {!loading && rows.length === 0 ? <tr><td style={tableCellStyle} colSpan={6}>No payout events found.</td></tr> : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={tableCellStyle}>{row.channel_code}</td>
                  <td style={tableCellStyle}>{row.payout_ref}</td>
                  <td style={tableCellStyle}>{new Date(row.payout_date).toLocaleDateString("en-GB")}</td>
                  <td style={tableCellStyle}>{row.currency} {Number(row.amount || 0).toLocaleString("en-IN")}</td>
                  <td style={tableCellStyle}>{row.status} {row.match_score != null ? `(score ${row.match_score})` : ""}</td>
                  <td style={tableCellStyle}>
                    {row.status !== "matched" && row.raw?.suggested_bank_transaction_id ? (
                      <button style={secondaryButtonStyle} onClick={() => void linkEvent(row.id, row.raw!.suggested_bank_transaction_id!, row.match_score)} disabled={busy}>Link suggested</button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
