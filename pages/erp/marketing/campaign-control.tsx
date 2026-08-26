import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import { ErpBadge, ErpButton, ErpCard, ErpTable } from "../../../components/erp/ui";
import { td, th, trHover } from "../../../components/erp/tw";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

type ControlRow = {
  control_id: string;
  campaign_layer: string | null;
  campaign_name: string | null;
  meta_campaign_id: string | null;
  current_budget: number | null;
  recommended_multiplier: number | null;
  recommended_new_budget: number | null;
  confidence_score: number | null;
  decision: string | null;
  decision_reason: string | null;
  decision_id: string | null;
  last_adjusted_at: string | null;
  status: string;
  action_eligibility: { can_approve: boolean; reason: string };
};

function inr(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹ ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;
}

export default function CampaignControlPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ControlRow[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [layerFilter, setLayerFilter] = useState("all");
  const [overrideByControl, setOverrideByControl] = useState<Record<string, string>>({});

  async function load(nextToken?: string | null) {
    setLoading(true);
    setError(null);
    const authToken = nextToken ?? token;

    const headers = {
      Authorization: authToken ? `Bearer ${authToken}` : "",
      "Content-Type": "application/json",
    };

    const [listRes, historyRes] = await Promise.all([
      fetch("/api/marketing/campaign-control/list", { headers }),
      fetch("/api/marketing/campaign-control/history?limit=50", { headers }),
    ]);

    const listJson = await listRes.json().catch(() => null);
    const historyJson = await historyRes.json().catch(() => null);

    if (!listRes.ok) {
      setError(listJson?.error || `Failed to load control list (${listRes.status})`);
      setRows([]);
      setHistory([]);
      setLoading(false);
      return;
    }

    setRows(Array.isArray(listJson?.rows) ? listJson.rows : []);
    setHistory(historyRes.ok && Array.isArray(historyJson?.rows) ? historyJson.rows : []);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getCompanyContext(session);
      if (!active) return;
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership");
        setLoading(false);
        return;
      }
      setToken(session.access_token ?? null);
      await load(session.access_token ?? null);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  async function postAction(control: ControlRow, action: "approve" | "reject" | "snooze") {
    const url = action === "approve" ? "/api/marketing/campaign-control/apply-budget" : "/api/marketing/campaign-control/reject-or-snooze";
    const body: any = {
      control_id: control.control_id,
      decision_id: control.decision_id,
      action,
    };

    const overrideRaw = overrideByControl[control.control_id];
    if (action === "approve" && overrideRaw?.trim()) {
      body.override_budget = Number(overrideRaw);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error || `Action failed (${response.status})`);
      return;
    }

    await load();
  }

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        if (decisionFilter !== "all" && (row.decision ?? "none") !== decisionFilter) return false;
        if (layerFilter !== "all" && (row.campaign_layer ?? "none") !== layerFilter) return false;
        return true;
      }),
    [rows, statusFilter, decisionFilter, layerFilter],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ErpPageHeader
        eyebrow="Marketing"
        title="Campaign Control"
        description="Human-in-the-loop Meta budget approvals with full audit trail."
        rightActions={<ErpButton onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</ErpButton>}
      />

      {error ? <ErpBadge tone="danger">{error}</ErpBadge> : null}

      <ErpCard title="Filters">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(160px, 220px))", gap: 10 }}>
          <label>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Status</div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
              <option value="all">All</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="disabled">disabled</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Decision</div>
            <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
              <option value="all">All</option>
              <option value="SCALE_UP">SCALE_UP</option>
              <option value="SCALE_DOWN">SCALE_DOWN</option>
              <option value="HOLD">HOLD</option>
              <option value="scale">scale</option>
              <option value="reduce">reduce</option>
              <option value="hold">hold</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Campaign layer</div>
            <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
              <option value="all">All</option>
              <option value="prospecting">prospecting</option>
              <option value="testing">testing</option>
              <option value="retargeting">retargeting</option>
              <option value="closer">closer</option>
              <option value="profit_protection">profit_protection</option>
            </select>
          </label>
        </div>
      </ErpCard>

      <ErpCard title="Recommendations & Controls">
        <ErpTable>
          <thead>
            <tr>
              <th className={th}>Campaign</th>
              <th className={th}>Layer</th>
              <th className={th}>Meta Campaign ID</th>
              <th className={th}>Current</th>
              <th className={th}>Recommended</th>
              <th className={th}>Multiplier</th>
              <th className={th}>Confidence</th>
              <th className={th}>Decision</th>
              <th className={th}>Last adjusted</th>
              <th className={th}>Status</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className={td} colSpan={11} style={{ opacity: 0.7 }}>
                  No campaign controls found.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.control_id} className={trHover}>
                  <td className={td}>
                    <div>{row.campaign_name || "—"}</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{row.decision_reason || "No reason"}</div>
                  </td>
                  <td className={td}>{row.campaign_layer || "—"}</td>
                  <td className={td}>{row.meta_campaign_id || "—"}</td>
                  <td className={td}>{inr(row.current_budget)}</td>
                  <td className={td}>{inr(row.recommended_new_budget)}</td>
                  <td className={td}>{row.recommended_multiplier == null ? "—" : `${row.recommended_multiplier.toFixed(2)}x`}</td>
                  <td className={td}>{row.confidence_score == null ? "—" : Number(row.confidence_score).toFixed(2)}</td>
                  <td className={td}>{row.decision || "—"}</td>
                  <td className={td}>{row.last_adjusted_at ? new Date(row.last_adjusted_at).toLocaleString() : "—"}</td>
                  <td className={td}>
                    <ErpBadge tone={row.status === "active" ? "success" : "default"}>{row.status}</ErpBadge>
                    {!row.action_eligibility.can_approve ? (
                      <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{row.action_eligibility.reason}</div>
                    ) : null}
                  </td>
                  <td className={td}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <input
                        placeholder="Override budget"
                        value={overrideByControl[row.control_id] ?? ""}
                        onChange={(e) =>
                          setOverrideByControl((prev) => ({
                            ...prev,
                            [row.control_id]: e.target.value,
                          }))
                        }
                        style={{ width: "100%", padding: "8px 10px" }}
                      />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <ErpButton disabled={!row.action_eligibility.can_approve} onClick={() => void postAction(row, "approve")}>
                          Approve
                        </ErpButton>
                        <ErpButton variant="secondary" onClick={() => void postAction(row, "reject")}>
                          Reject
                        </ErpButton>
                        <ErpButton variant="ghost" onClick={() => void postAction(row, "snooze")}>
                          Snooze
                        </ErpButton>
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ErpTable>
      </ErpCard>

      <ErpCard title="Action History">
        <ErpTable>
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Campaign</th>
              <th className={th}>Action</th>
              <th className={th}>Status</th>
              <th className={th}>Old budget</th>
              <th className={th}>New budget</th>
              <th className={th}>Actor</th>
              <th className={th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={8} className={td} style={{ opacity: 0.7 }}>
                  No actions logged yet.
                </td>
              </tr>
            ) : (
              history.map((row) => (
                <tr key={row.id} className={trHover}>
                  <td className={td}>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
                  <td className={td}>{row.meta_campaign_id}</td>
                  <td className={td}>{row.action_type}</td>
                  <td className={td}>{row.action_status}</td>
                  <td className={td}>{inr(row.old_budget == null ? null : Number(row.old_budget))}</td>
                  <td className={td}>{inr(row.new_budget == null ? null : Number(row.new_budget))}</td>
                  <td className={td}>{row.actor_email || "—"}</td>
                  <td className={td}>{row.error_message || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </ErpTable>
      </ErpCard>
    </div>
  );
}
