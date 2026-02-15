import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  pageWrapperStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";
import { useRouter } from "next/router";

type CapiEventRow = {
  id: string;
  created_at: string;
  event_name: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  event_id: string;
  payload: Record<string, unknown>;
};

const filterGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "end",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "grid",
  placeItems: "center",
  zIndex: 100,
};

const modalCardStyle: CSSProperties = {
  width: "min(900px, 92vw)",
  maxHeight: "80vh",
  overflow: "auto",
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 16,
};

export default function MarketingCapiEventsPage() {
  const router = useRouter();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [rows, setRows] = useState<CapiEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [eventName, setEventName] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedPayload, setSelectedPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      const session = await requireAuthRedirectHome(router);
      if (!session || !mounted) return;
      const context = await getCompanyContext(session);
      if (!mounted) return;
      if (!context.companyId) {
        setError("No active company mapped for current user");
        return;
      }
      setCompanyId(context.companyId);
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, [router]);

  const loadRows = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    let query = supabase
      .from("erp_mkt_capi_events")
      .select("id,created_at,event_name,status,attempt_count,last_error,event_id,payload")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(250);

    if (status !== "all") query = query.eq("status", status);
    if (eventName !== "all") query = query.eq("event_name", eventName);
    if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00Z`);
    if (toDate) query = query.lte("created_at", `${toDate}T23:59:59Z`);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as CapiEventRow[]);
    }
    setLoading(false);
  }, [companyId, eventName, fromDate, status, toDate]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const retryEvent = useCallback(
    async (id: string) => {
      const { error: updateError } = await supabase
        .from("erp_mkt_capi_events")
        .update({ status: "queued", last_error: null, sent_at: null })
        .eq("id", id)
        .eq("company_id", companyId ?? "");

      if (updateError) {
        setError(updateError.message);
        return;
      }
      await loadRows();
    },
    [companyId, loadRows],
  );

  const totalByStatus = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  return (
    <ErpShell activeModule="marketing">
      <div style={pageWrapperStyle}>
        <div style={pageContainerStyle}>
          <header style={pageHeaderStyle}>
            <div>
              <p style={eyebrowStyle}>Marketing</p>
              <h1 style={h1Style}>Meta CAPI Events</h1>
              <p style={subtitleStyle}>Monitor queue health, inspect payloads, and retry failed events.</p>
            </div>
            <div>
              <button style={secondaryButtonStyle} onClick={() => loadRows()} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </header>

          <section style={cardStyle}>
            <div style={filterGridStyle}>
              <label>
                <div>Status</div>
                <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="queued">Queued</option>
                  <option value="failed">Failed</option>
                  <option value="deadletter">Deadletter</option>
                  <option value="sent">Sent</option>
                </select>
              </label>
              <label>
                <div>Event</div>
                <select style={inputStyle} value={eventName} onChange={(e) => setEventName(e.target.value)}>
                  <option value="all">All</option>
                  <option value="AddToCart">AddToCart</option>
                  <option value="Purchase">Purchase</option>
                </select>
              </label>
              <label>
                <div>From</div>
                <input style={inputStyle} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label>
                <div>To</div>
                <input style={inputStyle} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
            </div>
          </section>

          <section style={cardStyle}>
            <p style={{ margin: "0 0 8px", color: "#475569" }}>
              Totals: queued {totalByStatus.queued ?? 0} · failed {totalByStatus.failed ?? 0} · deadletter {totalByStatus.deadletter ?? 0} · sent {totalByStatus.sent ?? 0}
            </p>
            {error ? <p style={{ margin: "0 0 12px", color: "#b91c1c" }}>{error}</p> : null}
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Created</th>
                    <th style={tableHeaderCellStyle}>Event</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Attempts</th>
                    <th style={tableHeaderCellStyle}>Event ID</th>
                    <th style={tableHeaderCellStyle}>Last Error</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={7}>
                        {loading ? "Loading…" : "No events found"}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <td style={tableCellStyle}>{new Date(row.created_at).toLocaleString()}</td>
                        <td style={tableCellStyle}>{row.event_name}</td>
                        <td style={tableCellStyle}>{row.status}</td>
                        <td style={tableCellStyle}>{row.attempt_count}</td>
                        <td style={tableCellStyle}>{row.event_id}</td>
                        <td style={tableCellStyle}>{row.last_error ?? "—"}</td>
                        <td style={tableCellStyle}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button style={secondaryButtonStyle} onClick={() => setSelectedPayload(row.payload)}>
                              View payload
                            </button>
                            {(row.status === "failed" || row.status === "deadletter") && (
                              <button style={primaryButtonStyle} onClick={() => retryEvent(row.id)}>
                                Retry
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {selectedPayload && (
        <div style={modalOverlayStyle} onClick={() => setSelectedPayload(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Meta payload</h3>
            <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(selectedPayload, null, 2)}</pre>
            <div style={{ marginTop: 12 }}>
              <button style={secondaryButtonStyle} onClick={() => setSelectedPayload(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </ErpShell>
  );
}
