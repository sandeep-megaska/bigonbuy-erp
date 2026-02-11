import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type ApiResp = {
  company_id: string;
  refreshed_at: string;
  snapshot: any;
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

export default function GrowthCockpitPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);

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
        setLoading(false);
        return;
      }

      setData(j);
      setLoading(false);
    } catch (e: any) {
      setErr(e?.message || "Network error");
      setData(null);
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

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}>Debug snapshot JSON</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, marginTop: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
