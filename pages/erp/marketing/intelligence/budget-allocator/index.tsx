import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

type SummaryPayload = {
  week_start: string | null;
  settings: {
    weekly_budget_inr: number;
    min_retargeting_share: number;
    max_prospecting_share: number;
  };
  recommendation: {
    scale_share: number;
    prospecting_share: number;
    retarget_share: number;
    scale_budget_inr: number;
    prospecting_budget_inr: number;
    retarget_budget_inr: number;
  };
  drivers: Record<string, unknown>;
  top: {
    scale_skus: Array<{ sku: string; demand_score: number; confidence_score: number; revenue_30d: number; orders_30d: number }>;
    expand_cities: Array<{ city: string; demand_score: number; confidence_score: number; revenue_30d: number; orders_30d: number }>;
  };
};

const rupee = (v: unknown) => `₹ ${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (v: unknown) => `${(Number(v ?? 0) * 100).toFixed(1)}%`;

export default function BudgetAllocatorPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [form, setForm] = useState({
    weekly_budget_inr: 0,
    min_retargeting_share: 0.2,
    max_prospecting_share: 0.6,
  });

  async function load(tokenOverride?: string | null) {
    setLoading(true);
    setErr(null);
    const ctx = await getCompanyContext();
    const accessToken = tokenOverride ?? ctx.session?.access_token ?? null;
    if (!accessToken || !ctx.companyId) {
      setErr("Missing auth/company context");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/marketing/budget-allocator/summary", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-erp-company-id": String(ctx.companyId),
      },
    });
    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to load budget allocator summary");
      setLoading(false);
      return;
    }

    setData(payload);
    setForm(payload.settings);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;
      setToken(session.access_token);
      await load(session.access_token);
    })();
  }, [router]);

  async function saveSettings() {
    if (!token) return;
    setSaving(true);
    setErr(null);
    const ctx = await getCompanyContext();

    const response = await fetch("/api/marketing/budget-allocator/settings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-erp-company-id": String(ctx.companyId ?? ""),
      },
      body: JSON.stringify(form),
    });

    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to save settings");
      setSaving(false);
      return;
    }

    await load(token);
    setSaving(false);
  }

  return (
    <>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px 40px" }}>
      <h1 style={{ marginTop: 0 }}>Budget Allocator</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>Weekly recommendation-only budget split for Product Push, Prospecting, and Retargeting.</p>
      {err ? <div style={{ background: "#fee", border: "1px solid #fbb", borderRadius: 8, padding: 10, marginBottom: 12 }}>{err}</div> : null}

      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Settings</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <label>
            Weekly Budget (INR)
            <input type="number" min={0} value={form.weekly_budget_inr} onChange={(e) => setForm((prev) => ({ ...prev, weekly_budget_inr: Number(e.target.value) }))} style={{ width: "100%" }} />
          </label>
          <label>
            Min Retargeting Share (0-1)
            <input type="number" min={0} max={1} step="0.01" value={form.min_retargeting_share} onChange={(e) => setForm((prev) => ({ ...prev, min_retargeting_share: Number(e.target.value) }))} style={{ width: "100%" }} />
          </label>
          <label>
            Max Prospecting Share (0-1)
            <input type="number" min={0} max={1} step="0.01" value={form.max_prospecting_share} onChange={(e) => setForm((prev) => ({ ...prev, max_prospecting_share: Number(e.target.value) }))} style={{ width: "100%" }} />
          </label>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={saveSettings} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          <button type="button" onClick={() => { window.location.href = "/api/marketing/budget-allocator/export.csv"; }}>
            Export CSV
          </button>
          <span style={{ opacity: 0.7 }}>Week: {data?.week_start ?? "—"}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>Product Push (Scale SKUs)</div>
          <div>{rupee(data?.recommendation.scale_budget_inr)}</div>
          <div style={{ opacity: 0.7 }}>{pct(data?.recommendation.scale_share)}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>Prospecting (Expand Cities)</div>
          <div>{rupee(data?.recommendation.prospecting_budget_inr)}</div>
          <div style={{ opacity: 0.7 }}>{pct(data?.recommendation.prospecting_share)}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>Retargeting Baseline</div>
          <div>{rupee(data?.recommendation.retarget_budget_inr)}</div>
          <div style={{ opacity: 0.7 }}>{pct(data?.recommendation.retarget_share)}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Why this split?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          {Object.entries(data?.drivers ?? {}).map(([k, v]) => (
            <div key={k} style={{ border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{k}</div>
              <div style={{ fontWeight: 600 }}>{String(v)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 10 Scale SKUs</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", opacity: 0.7 }}><th>SKU</th><th>Demand</th><th>Confidence</th><th>Revenue 30d</th><th>Orders 30d</th></tr></thead>
            <tbody>
              {(data?.top.scale_skus ?? []).map((row) => (
                <tr key={row.sku} style={{ borderTop: "1px solid #eee" }}><td>{row.sku}</td><td>{row.demand_score.toFixed(3)}</td><td>{pct(row.confidence_score)}</td><td>{rupee(row.revenue_30d)}</td><td>{row.orders_30d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top 10 Expand Cities</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", opacity: 0.7 }}><th>City</th><th>Demand</th><th>Confidence</th><th>Revenue 30d</th><th>Orders 30d</th></tr></thead>
            <tbody>
              {(data?.top.expand_cities ?? []).map((row) => (
                <tr key={row.city} style={{ borderTop: "1px solid #eee" }}><td>{row.city}</td><td>{row.demand_score.toFixed(3)}</td><td>{pct(row.confidence_score)}</td><td>{rupee(row.revenue_30d)}</td><td>{row.orders_30d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {loading ? <div style={{ marginTop: 12, opacity: 0.7 }}>Loading...</div> : null}
      </div>
    </>
  );
}
