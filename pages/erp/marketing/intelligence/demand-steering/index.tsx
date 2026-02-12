import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

type DemandRow = {
  sku?: string;
  city?: string;
  orders_30d: number;
  revenue_30d: number;
  orders_prev_30d: number;
  revenue_prev_30d: number;
  growth_rate: number;
  demand_score: number;
  decision: string;
};

type SummaryResp = {
  week_start: string | null;
  refreshed_at: string | null;
  scale_skus: DemandRow[];
  reduce_skus: DemandRow[];
  expand_cities: DemandRow[];
  reduce_cities: DemandRow[];
};

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const currency = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (value: unknown) => `${(Number(value ?? 0) * 100).toFixed(1)}%`;

function DemandTable({
  title,
  rows,
  entityKey,
}: {
  title: string;
  rows: DemandRow[];
  entityKey: "sku" | "city";
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7, fontSize: 12 }}>
            <th style={{ padding: "6px 0" }}>{entityKey === "sku" ? "SKU" : "City"}</th>
            <th style={{ padding: "6px 0" }}>Orders 30d</th>
            <th style={{ padding: "6px 0" }}>Revenue 30d</th>
            <th style={{ padding: "6px 0" }}>Growth</th>
            <th style={{ padding: "6px 0" }}>Demand Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: "10px 0", opacity: 0.7 }}>
                No recommendations yet
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={`${row[entityKey] ?? idx}`} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: "8px 0" }}>{row[entityKey] ?? "—"}</td>
                <td style={{ padding: "8px 0" }}>{number(row.orders_30d)}</td>
                <td style={{ padding: "8px 0" }}>₹ {currency(row.revenue_30d)}</td>
                <td style={{ padding: "8px 0" }}>{pct(row.growth_rate)}</td>
                <td style={{ padding: "8px 0" }}>{Number(row.demand_score ?? 0).toFixed(3)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DemandSteeringPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SummaryResp | null>(null);

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

    const response = await fetch("/api/marketing/demand-steering/summary", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-erp-company-id": String(ctx.companyId),
      },
    });
    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to load demand steering summary");
      setLoading(false);
      return;
    }
    setData(payload);
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

  async function refresh() {
    if (!token) return;
    setRefreshing(true);
    setErr(null);

    const ctx = await getCompanyContext();
    const response = await fetch("/api/marketing/demand-steering/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-erp-company-id": String(ctx.companyId ?? ""),
      },
      body: JSON.stringify({}),
    });

    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to refresh demand steering");
      setRefreshing(false);
      return;
    }

    await load(token);
    setRefreshing(false);
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Demand Steering</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
            Weekly demand recommendations for SKU and city expansion without ad spend dependencies.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || loading}
          style={{
            border: "1px solid #bbb",
            borderRadius: 8,
            padding: "8px 14px",
            background: "#fff",
            cursor: refreshing || loading ? "not-allowed" : "pointer",
            opacity: refreshing || loading ? 0.7 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14 }}>
        <div>
          <strong>Week Start:</strong> {data?.week_start ?? "—"}
        </div>
        <div>
          <strong>Last refreshed:</strong> {data?.refreshed_at ? new Date(data.refreshed_at).toLocaleString() : "—"}
        </div>
      </div>

      {err ? <div style={{ color: "#a00", marginTop: 12 }}>{err}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading…</div> : null}

      {!loading && !err ? (
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <DemandTable title="Scale SKUs" rows={data?.scale_skus ?? []} entityKey="sku" />
          <DemandTable title="Reduce SKUs" rows={data?.reduce_skus ?? []} entityKey="sku" />
          <DemandTable title="Expand Cities" rows={data?.expand_cities ?? []} entityKey="city" />
          <DemandTable title="Reduce Cities" rows={data?.reduce_cities ?? []} entityKey="city" />
        </div>
      ) : null}
    </div>
  );
}
