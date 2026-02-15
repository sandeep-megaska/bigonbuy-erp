import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { badgeBase, card, cardTitle, table, tableWrap, td, th, trHover } from "../../../../../components/erp/tw";

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
  confidence_score: number;
  recommended_pct_change: number;
  guardrail_tags: string[];
};

type SummaryResp = {
  week_start: string | null;
  refreshed_at: string | null;
  playbook: {
    scale_skus: DemandRow[];
    reduce_skus: DemandRow[];
    expand_cities: DemandRow[];
    reduce_cities: DemandRow[];
  };
  tables: {
    scale_skus: DemandRow[];
    reduce_skus: DemandRow[];
    expand_cities: DemandRow[];
    reduce_cities: DemandRow[];
  };
};

type ActivationSkuRow = {
  sku: string;
  demand_score: number;
  confidence_score: number;
  recommended_pct_change: number;
  guardrail_tags?: string[];
};

type ActivationCityRow = {
  city: string;
  demand_score: number;
  confidence_score: number;
  recommended_pct_change: number;
};

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const currency = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (value: unknown) => `${(Number(value ?? 0) * 100).toFixed(1)}%`;
const changePct = (value: unknown) => `${Number(value ?? 0) > 0 ? "+" : ""}${Number(value ?? 0).toFixed(0)}%`;
const confidenceText = (value: unknown) => `${(Number(value ?? 0) * 100).toFixed(0)}%`;

function DemandGuardrails({ tags, highlightOnly = false }: { tags: string[]; highlightOnly?: boolean }) {
  const visibleTags = highlightOnly
    ? tags.filter((x) => ["PROTECT_AMAZON", "LOW_INVENTORY", "LOW_SAMPLE"].includes(x))
    : tags;

  if (visibleTags.length === 0) {
    return <span style={{ opacity: 0.65 }}>—</span>;
  }

  return (
    <>
      {visibleTags.map((tag) => (
        <span key={tag} className={badgeBase} style={{ marginRight: 6, marginBottom: 4 }}>
          {tag}
        </span>
      ))}
    </>
  );
}

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
    <div className={card}>
      <div className={cardTitle}>{title}</div>
      <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th style={{ padding: "6px 0" }}>{entityKey === "sku" ? "SKU" : "City"}</th>
            <th style={{ padding: "6px 0" }}>Orders 30d</th>
            <th style={{ padding: "6px 0" }}>Revenue 30d</th>
            <th style={{ padding: "6px 0" }}>Growth</th>
            <th style={{ padding: "6px 0" }}>Demand Score</th>
            <th style={{ padding: "6px 0" }}>Confidence</th>
            <th style={{ padding: "6px 0" }}>Suggested Budget Δ</th>
            <th style={{ padding: "6px 0" }}>Guardrails</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className={td} style={{ opacity: 0.7 }}>
                No recommendations yet
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={`${row[entityKey] ?? idx}`} className={trHover}>
                <td className={td}>{row[entityKey] ?? "—"}</td>
                <td className={td}>{number(row.orders_30d)}</td>
                <td className={td}>₹ {currency(row.revenue_30d)}</td>
                <td className={td}>{pct(row.growth_rate)}</td>
                <td className={td}>{Number(row.demand_score ?? 0).toFixed(3)}</td>
                <td className={td}>{confidenceText(row.confidence_score)}</td>
                <td className={td}>{changePct(row.recommended_pct_change)}</td>
                <td className={td}>
                  <DemandGuardrails tags={row.guardrail_tags ?? []} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      </div>
  );
}

function ActivationTable({
  title,
  rows,
  entityKey,
}: {
  title: string;
  rows: (ActivationSkuRow | ActivationCityRow)[];
  entityKey: "sku" | "city";
}) {
  return (
    <div className={card}>
      <div className={cardTitle}>{title}</div>
      <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th style={{ padding: "6px 0" }}>{entityKey === "sku" ? "SKU" : "City"}</th>
            <th style={{ padding: "6px 0" }}>Demand Score</th>
            <th style={{ padding: "6px 0" }}>Confidence</th>
            <th style={{ padding: "6px 0" }}>Suggested Budget Δ</th>
            <th style={{ padding: "6px 0" }}>Guardrails</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={td} style={{ opacity: 0.7 }}>
                No activation actions yet
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const entityLabel = entityKey === "sku" ? (row as ActivationSkuRow).sku : (row as ActivationCityRow).city;
              return (
              <tr key={`${entityLabel ?? idx}`} className={trHover}>
                <td className={td}>{entityLabel ?? "—"}</td>
                <td className={td}>{Number(row.demand_score ?? 0).toFixed(3)}</td>
                <td className={td}>{confidenceText(row.confidence_score)}</td>
                <td className={td}>{changePct(row.recommended_pct_change)}</td>
                <td className={td}>
                  <DemandGuardrails tags={(row as ActivationSkuRow).guardrail_tags ?? []} />
                </td>
              </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
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
  const [activationScaleSkus, setActivationScaleSkus] = useState<ActivationSkuRow[]>([]);
  const [activationExpandCities, setActivationExpandCities] = useState<ActivationCityRow[]>([]);
  const [activationReduceSkus, setActivationReduceSkus] = useState<ActivationSkuRow[]>([]);

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

    const [scaleResp, expandResp, reduceResp] = await Promise.all([
      fetch("/api/marketing/activation/scale-skus", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-erp-company-id": String(ctx.companyId),
        },
      }),
      fetch("/api/marketing/activation/expand-cities", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-erp-company-id": String(ctx.companyId),
        },
      }),
      fetch("/api/marketing/activation/reduce-skus", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-erp-company-id": String(ctx.companyId),
        },
      }),
    ]);

    const [scalePayload, expandPayload, reducePayload] = await Promise.all([
      scaleResp.json(),
      expandResp.json(),
      reduceResp.json(),
    ]);

    if (scaleResp.ok) setActivationScaleSkus(scalePayload?.rows ?? []);
    if (expandResp.ok) setActivationExpandCities(expandPayload?.rows ?? []);
    if (reduceResp.ok) setActivationReduceSkus(reducePayload?.rows ?? []);

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
    <>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Demand Steering</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
            Weekly demand recommendations for SKU and city expansion without ad spend dependencies.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href="/api/marketing/demand-steering/export-scale-skus.csv"
            target="_blank"
            rel="noreferrer"
            style={{
              border: "1px solid #bbb",
              borderRadius: 8,
              padding: "8px 14px",
              background: "#fff",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Export Scale SKUs (CSV)
          </a>
          <a
            href="/api/marketing/demand-steering/export-expand-cities.csv"
            target="_blank"
            rel="noreferrer"
            style={{
              border: "1px solid #bbb",
              borderRadius: 8,
              padding: "8px 14px",
              background: "#fff",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Export Expand Cities (CSV)
          </a>
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
      </div>

      <div className={card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Playbook</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, marginBottom: 10 }}>
          <div>
            <strong>Week Start:</strong> {data?.week_start ?? "—"}
          </div>
          <div>
            <strong>Last refreshed:</strong> {data?.refreshed_at ? new Date(data.refreshed_at).toLocaleString() : "—"}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Top 5 Scale SKUs</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(data?.playbook.scale_skus ?? []).map((row, idx) => (
                <li key={`${row.sku ?? idx}`}>
                  {row.sku ?? "—"} · ₹ {currency(row.revenue_30d)} · {changePct(row.recommended_pct_change)} · conf {confidenceText(row.confidence_score)}{" "}
                  <DemandGuardrails tags={row.guardrail_tags ?? []} highlightOnly />
                </li>
              ))}
              {(data?.playbook.scale_skus ?? []).length === 0 ? <li>No recommendations yet</li> : null}
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Top 5 Expand Cities</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(data?.playbook.expand_cities ?? []).map((row, idx) => (
                <li key={`${row.city ?? idx}`}>
                  {row.city ?? "—"} · ₹ {currency(row.revenue_30d)} · {changePct(row.recommended_pct_change)} · conf {confidenceText(row.confidence_score)}{" "}
                  <DemandGuardrails tags={row.guardrail_tags ?? []} highlightOnly />
                </li>
              ))}
              {(data?.playbook.expand_cities ?? []).length === 0 ? <li>No recommendations yet</li> : null}
            </ul>
          </div>
        </div>
      </div>

      {err ? <div style={{ color: "#a00", marginTop: 12 }}>{err}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading…</div> : null}

      {!loading && !err ? (
        <>
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <DemandTable title="Scale SKUs" rows={data?.tables.scale_skus ?? []} entityKey="sku" />
            <DemandTable title="Reduce SKUs" rows={data?.tables.reduce_skus ?? []} entityKey="sku" />
            <DemandTable title="Expand Cities" rows={data?.tables.expand_cities ?? []} entityKey="city" />
            <DemandTable title="Reduce Cities" rows={data?.tables.reduce_cities ?? []} entityKey="city" />
          </div>

          <div className={card} style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>This Week’s Activation Actions</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>Scale SKUs (Top 20)</div>
                  <a href="/api/marketing/activation/export-scale-skus.csv" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    Export CSV
                  </a>
                </div>
                <ActivationTable title="Scale SKUs" rows={activationScaleSkus} entityKey="sku" />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>Expand Cities (Top 20)</div>
                  <a href="/api/marketing/activation/export-expand-cities.csv" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    Export CSV
                  </a>
                </div>
                <ActivationTable title="Expand Cities" rows={activationExpandCities} entityKey="city" />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>Reduce SKUs (Top 20)</div>
                  <a href="/api/marketing/activation/export-reduce-skus.csv" target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    Export CSV
                  </a>
                </div>
                <ActivationTable title="Reduce SKUs" rows={activationReduceSkus} entityKey="sku" />
              </div>
            </div>
          </div>
        </>
      ) : null}
      </div>
    </>
  );
}
