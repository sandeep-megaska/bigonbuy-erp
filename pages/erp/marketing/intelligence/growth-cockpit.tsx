import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { ErpBadge, ErpButton, ErpCard, ErpStatCard, ErpTable } from "../../../../components/erp/ui";
import { td, th, trHover } from "../../../../components/erp/tw";
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
        setScalingData({
          ok: false,
          dt: null,
          target_roas: 3,
          rows: [],
          error: scalingJson?.error || `Request failed (${scalingRes.status})`,
        });
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
      {
        label: "Shopify Revenue",
        value: snap.shopify_revenue == null ? "—" : `₹ ${formatINR(snap.shopify_revenue)}`,
      },
      {
        label: "Amazon Revenue",
        value: snap.amazon_revenue == null ? "—" : `₹ ${formatINR(snap.amazon_revenue)}`,
      },
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ErpPageHeader
        eyebrow="Marketing"
        title="Growth Cockpit"
        description="CEO snapshot with blended performance, city/SKU leaders, and scaling recommendations."
        rightActions={<ErpButton onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</ErpButton>}
      />

      {err ? <ErpBadge tone="danger">Error: {err}</ErpBadge> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <ErpStatCard key={c.label} label={c.label} value={String(c.value)} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ErpCard title="Top SKUs">
          <ErpTable>
            <thead>
              <tr>
                <th className={th}>SKU</th>
                <th className={th}>Orders</th>
                <th className={th}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topSkus.length === 0 ? (
                <tr>
                  <td colSpan={3} className={td} style={{ opacity: 0.7 }}>
                    No data yet
                  </td>
                </tr>
              ) : (
                topSkus.map((r, idx) => (
                  <tr key={`${r.sku_code ?? r.sku ?? idx}`} className={trHover}>
                    <td className={td}>{r.sku_code ?? r.sku ?? "—"}</td>
                    <td className={td}>{r.orders_count ?? "—"}</td>
                    <td className={td}>₹ {formatINR(r.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ErpTable>
        </ErpCard>

        <ErpCard title="Top Cities">
          <ErpTable>
            <thead>
              <tr>
                <th className={th}>City</th>
                <th className={th}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topCities.length === 0 ? (
                <tr>
                  <td colSpan={2} className={td} style={{ opacity: 0.7 }}>
                    No data yet
                  </td>
                </tr>
              ) : (
                topCities.map((r, idx) => (
                  <tr key={`${r.city ?? idx}`} className={trHover}>
                    <td className={td}>{r.city ?? "—"}</td>
                    <td className={td}>₹ {formatINR(r.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ErpTable>
        </ErpCard>
      </div>

      <ErpCard
        title="Today's Scaling Recommendations"
        subtitle={scalingData?.dt ? `As of ${scalingData.dt}` : "No recommendation snapshot"}
      >
        <div style={{ marginBottom: 10 }}>
          <ErpBadge>Target ROAS: {scalingData?.target_roas ?? 3}</ErpBadge>
        </div>
        {scalingData && !scalingData.ok ? (
          <div style={{ marginBottom: 8, fontSize: 12, color: "#b42318" }}>
            Failed to load recommendations: {scalingData.error ?? "Unknown error"}
          </div>
        ) : null}
        {scalingRows.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No recommendations yet</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {([
              ["SCALE_UP", "success"] as const,
              ["HOLD", "default"] as const,
              ["SCALE_DOWN", "danger"] as const,
            ] as const).map(([key, tone]) => {
              const rows = groupedScalingRows[key];
              if (!rows.length) return null;
              return (
                <div key={key} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                  <ErpBadge tone={tone}>{key}</ErpBadge>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {rows.map((row) => (
                      <div
                        key={`${row.campaign_id}-${row.reason}`}
                        style={{ borderRadius: 8, padding: 8, background: "#f8fafc" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 600 }}>{row.campaign_name || row.campaign_id}</div>
                          <div style={{ fontWeight: 700 }}>
                            {row.recommendation === "HOLD" ? "HOLD 0%" : `SCALE ${formatScalePct(row.pct_change)}`}
                          </div>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                          ROAS 7d: {row.blended_roas_7d == null ? "—" : row.blended_roas_7d.toFixed(2)} · Spend
                          7d: ₹ {formatINR(row.spend_7d)} · Volatility 7d: {row.volatility_7d == null ? "—" : row.volatility_7d.toFixed(2)}
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
      </ErpCard>

      <details>
        <summary style={{ cursor: "pointer" }}>Debug snapshot JSON</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, marginTop: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
