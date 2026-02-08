import { useEffect, useMemo, useState } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";
import { useRouter } from "next/router";

type ReadinessStatus = "green" | "amber" | "red";

type ReadinessRow = {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string | null;
  readiness_status: ReadinessStatus;
  reasons: string[] | null;
  open_po_lines: number;
  bom_missing_skus: number;
  shortage_materials: number;
  cutting_events_pending_consumption: number;
};

type PendingStageEvent = {
  stage_event_id: string;
  vendor_name: string | null;
  po_number: string | null;
  sku: string;
  completed_qty_delta: number;
  consumption_status: string;
  consumption_batch_id: string | null;
};

export default function VendorReadinessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [pendingEvents, setPendingEvents] = useState<PendingStageEvent[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const ctx = await getCompanyContext(session);
      if (!ctx?.companyId) {
        if (active) {
          setError(ctx?.membershipError || "No active company membership found for this user.");
          setLoading(false);
        }
        return;
      }

      const { data, error: rpcError } = await supabase.rpc("erp_vendor_readiness_list_v1", {
        p_company_id: ctx.companyId,
        p_from: null,
        p_to: null,
      });

      if (!active) return;
      if (rpcError) {
        setError(rpcError.message || "Failed to load vendor readiness");
        setLoading(false);
        return;
      }

      setRows((Array.isArray(data) ? data : []) as ReadinessRow[]);
      await loadPending(active);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadPending(active = true) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return;

    const res = await fetch("/api/mfg/internal/stage-events/pending?limit=50", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!active) return;
    if (!res.ok || !json?.ok) {
      setError(json?.error || "Failed to load pending cutting events");
      return;
    }

    setPendingEvents(Array.isArray(json?.data?.items) ? json.data.items : []);
  }

  async function postConsumption(stageEventId: string) {
    setBusyId(stageEventId);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");

      const res = await fetch(`/api/mfg/internal/stage-events/${encodeURIComponent(stageEventId)}/post-consumption`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ reason: "ERP readiness posting" }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to post consumption");
      await loadPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post consumption");
    } finally {
      setBusyId(null);
    }
  }

  async function reverseConsumption(batchId: string) {
    setBusyId(batchId);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");

      const res = await fetch(`/api/mfg/internal/consumption-batches/${encodeURIComponent(batchId)}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ reason: "ERP readiness reversal", clientReverseId: crypto.randomUUID() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to reverse consumption");
      await loadPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reverse consumption");
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.readiness_status] += 1;
        return acc;
      },
      { green: 0, amber: 0, red: 0 } as Record<ReadinessStatus, number>,
    );
  }, [rows]);

  return (
    <ErpShell>
      <main style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <h1 style={h1Style}>Vendor Readiness</h1>
            <p style={subtitleStyle}>Green / Amber / Red readiness based on open POs, BOM coverage, shortages, and cutting events pending consumption posting.</p>
          </div>
        </header>

        <section style={cardStyle}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <StatusPill status="green" label={`Green: ${counts.green}`} />
            <StatusPill status="amber" label={`Amber: ${counts.amber}`} />
            <StatusPill status="red" label={`Red: ${counts.red}`} />
          </div>

          {loading ? <div>Loading readiness…</div> : null}
          {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

          {!loading && !error ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Open PO lines</th>
                    <th style={tableHeaderCellStyle}>BOM missing</th>
                    <th style={tableHeaderCellStyle}>Shortages</th>
                    <th style={tableHeaderCellStyle}>Cutting pending</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.vendor_id}>
                      <td style={tableCellStyle}>{row.vendor_name}</td>
                      <td style={tableCellStyle}>{row.open_po_lines}</td>
                      <td style={tableCellStyle}>{row.bom_missing_skus}</td>
                      <td style={tableCellStyle}>{row.shortage_materials}</td>
                      <td style={tableCellStyle}>{row.cutting_events_pending_consumption || 0}</td>
                      <td style={tableCellStyle}>
                        <StatusPill status={row.readiness_status} label={row.readiness_status.toUpperCase()} />
                      </td>
                      <td style={tableCellStyle}>{(row.reasons || []).join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section style={{ ...cardStyle, marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Cutting Events Pending Consumption</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>PO</th>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>Delta Qty</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingEvents.map((evt) => (
                  <tr key={evt.stage_event_id}>
                    <td style={tableCellStyle}>{evt.vendor_name || "—"}</td>
                    <td style={tableCellStyle}>{evt.po_number || "—"}</td>
                    <td style={tableCellStyle}>{evt.sku}</td>
                    <td style={tableCellStyle}>{evt.completed_qty_delta}</td>
                    <td style={tableCellStyle}>{evt.consumption_status}</td>
                    <td style={tableCellStyle}>
                      {evt.consumption_status === "pending" ? (
                        <button disabled={busyId === evt.stage_event_id} onClick={() => void postConsumption(evt.stage_event_id)}>Post Consumption</button>
                      ) : evt.consumption_batch_id ? (
                        <button disabled={busyId === evt.consumption_batch_id} onClick={() => void reverseConsumption(evt.consumption_batch_id as string)}>Reverse</button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {pendingEvents.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>No cutting events found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </ErpShell>
  );
}

function StatusPill({ status, label }: { status: ReadinessStatus; label: string }) {
  const styleMap: Record<ReadinessStatus, { bg: string; fg: string }> = {
    green: { bg: "#dcfce7", fg: "#166534" },
    amber: { bg: "#fef3c7", fg: "#92400e" },
    red: { bg: "#fee2e2", fg: "#991b1b" },
  };

  const st = styleMap[status];
  return (
    <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}
