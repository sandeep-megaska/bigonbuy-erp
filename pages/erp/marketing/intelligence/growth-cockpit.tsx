import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type ApiResp = {
  company_id: string;
  refreshed_at: string;
  snapshot: any;
};


type ScalingRecommendationRow = {
  campaign_id: string;
  campaign_name: string | null;
  recommendation: "SCALE_UP" | "SCALE_DOWN" | "HOLD";
  pct_change: number;
  reason: string;
  blended_roas_7d: number | null;
  blended_roas_3d: number | null;
  spend_3d: number | null;
  spend_7d: number | null;
  volatility_7d: number | null;
};

type ScalingApiResp = {
  ok: boolean;
  dt: string | null;
  target_roas: number;
  rows: ScalingRecommendationRow[];
  error?: string;
};

function formatINR(n: any) {
  const num = typeof n === "number" ? n : n == null ? null : Number(n);
  if (num == null || Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(num);
}

function formatPct(x: any) {
  const num = typeof x === "number" ? x : x == null ? null : Number(x);
  if (num == null || Number.isNaN(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}



function formatScalePct(x: number) {
  if (!Number.isFinite(x)) return "0%";
  const sign = x > 0 ? "+" : "";
  return `${sign}${Math.round(x * 100)}%`;
}
export default function GrowthCockpitPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);
  const [scalingData, setScalingData] = useState<ScalingApiResp | null>(null);

  async function load(tokenOverride?: string | null) {
    setLoading(true);
    setErr(null);
    try {
      const authToken = tokenOverride ?? token;
      const r = await fetch("/api/marketing/intelligence/growth-cockpit", {
        method: "GET",
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : "",
          "Content-Type": "application/json",
        },
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        setErr(j?.error || `Request failed (${r.status})`);
        setData(null);
        setScalingData(null);
        setLoading(false);
        return;
      }

      setData(j);

      const scalingRes = await fetch("/api/marketing/growth/scaling-recommendations?limit=10", {
        method: "GET",
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : "",
          "Content-Type": "application/json",
        },
      });
      const scalingJson = await scalingRes.json().catch(() => null);
      if (scalingRes.ok) {
        setScalingData(scalingJson);
      } else {
        setScalingData({ ok: false, dt: null, target_roas: 3, rows: [], error: scalingJson?.error || `Request failed (${scalingRes.status})` });
      }

      setLoading(false);
    } catch (e: any) {
      setErr(e?.message || "Network error");
      setData(null);
      setScalingData(null);
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const companyContext = await getCompanyContext(session);
      if (!active) return;
      if (!companyContext.companyId) {
        setErr(companyContext.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      const sessionToken = session.access_token ?? null;
      setToken(sessionToken);
      await load(sessionToken);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const snap = data?.snapshot || {};
  const cards = useMemo(
    () => [
      { label: "Blended ROAS (7d)", value: snap.blended_roas_7d ?? "—" },
      { label: "Blended ROAS (30d)", value: snap.blended_roas_30d ?? "—" },
      { label: "Meta Spend", value: snap.meta_spend == null ? "—" : `₹ ${formatINR(snap.meta_spend)}` },
      { label: "Shopify Revenue", value: snap.shopify_revenue == null ? "—" : `₹ ${formatINR(snap.shopify_revenue)}` },
      { label: "Amazon Revenue", value: snap.amazon_revenue == null ? "—" : `₹ ${formatINR(snap.amazon_revenue)}` },
      { label: "D2C Share", value: snap.d2c_share_pct == null ? "—" : formatPct(snap.d2c_share_pct) },
    ],
    [snap]
  );

  const topSkus: Array<any> = Array.isArray(snap.top_skus) ? snap.top_skus : [];
  const topCities: Array<any> = Array.isArray(snap.top_cities) ? snap.top_cities : [];
  const scalingRows = Array.isArray(scalingData?.rows) ? scalingData?.rows : [];
  const groupedScalingRows = {
    SCALE_UP: scalingRows.filter((r) => r.recommendation === "SCALE_UP"),
    HOLD: scalingRows.filter((r) => r.recommendation === "HOLD"),
    SCALE_DOWN: scalingRows.filter((r) => r.recommendation === "SCALE_DOWN"),
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Growth Cockpit</h1>
          <div style={{ opacity: 0.75, marginTop: 4 }}>CEO snapshot (from materialized view)</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void load()} disabled={loading} style={{ padding: "8px 12px", cursor: "pointer" }}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
        {data?.company_id ? <span>Company: {data.company_id}</span> : null}
        {data?.refreshed_at ? <span> · Refreshed: {new Date(data.refreshed_at).toLocaleString()}</span> : null}
      </div>

      {err ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #f5c2c7", background: "#f8d7da" }}>
          <b>Error:</b> {err}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <div key={c.label} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{c.label}</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700 }}>{String(c.value)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top SKUs</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7, fontSize: 12 }}>
                <th style={{ padding: "6px 0" }}>SKU</th>
                <th style={{ padding: "6px 0" }}>Orders</th>
                <th style={{ padding: "6px 0" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topSkus.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "10px 0", opacity: 0.7 }}>
                    No data yet
                  </td>
                </tr>
              ) : (
                topSkus.map((r, idx) => (
                  <tr key={`${r.sku_code ?? r.sku ?? idx}`} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "8px 0" }}>{r.sku_code ?? r.sku ?? "—"}</td>
                    <td style={{ padding: "8px 0" }}>{r.orders_count ?? "—"}</td>
                    <td style={{ padding: "8px 0" }}>₹ {formatINR(r.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Top Cities</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7, fontSize: 12 }}>
                <th style={{ padding: "6px 0" }}>City</th>
                <th style={{ padding: "6px 0" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topCities.length === 0 ? (
                <tr>
                  <td colSpan={2} style={{ padding: "10px 0", opacity: 0.7 }}>
                    No data yet
                  </td>
                </tr>
              ) : (
                topCities.map((r, idx) => (
                  <tr key={`${r.city ?? idx}`} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "8px 0" }}>{r.city ?? "—"}</td>
                    <td style={{ padding: "8px 0" }}>₹ {formatINR(r.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>


      <div style={{ marginTop: 18, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontWeight: 700 }}>Today&apos;s Scaling Recommendations</div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {scalingData?.dt ? `As of ${scalingData.dt}` : "No recommendation snapshot"}
          </div>
        </div>
        <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>Target ROAS: {scalingData?.target_roas ?? 3}</div>
        {scalingData && !scalingData.ok ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b42318" }}>Failed to load recommendations: {scalingData.error ?? "Unknown error"}</div>
        ) : null}
        {scalingRows.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>No recommendations yet</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {([
              ["SCALE_UP", "#067647", "#ecfdf3"],
              ["HOLD", "#344054", "#f2f4f7"],
              ["SCALE_DOWN", "#b42318", "#fef3f2"],
            ] as const).map(([key, color, bg]) => {
              const rows = groupedScalingRows[key];
              if (!rows.length) return null;
              return (
                <div key={key} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 6 }}>{key}</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {rows.map((row) => (
                      <div key={`${row.campaign_id}-${row.reason}`} style={{ borderRadius: 8, padding: 8, background: bg }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 600 }}>{row.campaign_name || row.campaign_id}</div>
                          <div style={{ fontWeight: 700 }}>
                            {row.recommendation === "SCALE_UP" ? "SCALE" : row.recommendation === "SCALE_DOWN" ? "SCALE" : "HOLD"}{" "}
                            {row.recommendation === "HOLD" ? "0%" : formatScalePct(row.pct_change)}
                          </div>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                          ROAS 7d: {row.blended_roas_7d == null ? "—" : row.blended_roas_7d.toFixed(2)} · Spend 7d: ₹ {formatINR(row.spend_7d)} · Volatility 7d: {row.volatility_7d == null ? "—" : row.volatility_7d.toFixed(2)}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 12, opacity: 0.75 }}>Reason: {row.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}>Debug snapshot JSON</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, marginTop: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
