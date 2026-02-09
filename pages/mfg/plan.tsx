import { useEffect, useMemo, useState, type CSSProperties } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";

type BucketRow = { bucket_start: string; qty?: number; demand_qty?: number; projected_balance?: number; shortage_qty?: number };
type SkuRow = {
  sku: string;
  variant_id: string;
  product: string;
  size: string | null;
  color: string | null;
  total_open_qty: number;
  overdue_qty: number;
  recommended_daily_rate: number;
  wip_hint_qty: number;
  risk_flag: boolean;
  bom_status: "OK" | "MISSING";
  buckets: BucketRow[];
};

type MaterialRow = {
  material_id: string;
  material_name: string;
  uom: string;
  on_hand: number;
  reorder_level: number;
  lead_time_days: number;
  buckets: BucketRow[];
  first_shortage_bucket_start: string | null;
  recommended_reorder_qty: number;
  recommended_order_by_date: string | null;
};

export default function VendorPlanPage() {
  const [horizonDays, setHorizonDays] = useState(30);
  const [bucket, setBucket] = useState<"WEEK" | "DAY">("WEEK");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<any>({});
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);

  useEffect(() => {
    void loadData();
  }, [horizonDays, bucket]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const qs = `horizon_days=${horizonDays}&bucket=${bucket}`;
      const [sRes, skuRes, matRes] = await Promise.all([
        fetch(`/api/mfg/plan/summary?horizon_days=${horizonDays}`),
        fetch(`/api/mfg/plan/sku-forecast?${qs}`),
        fetch(`/api/mfg/plan/material-forecast?${qs}`),
      ]);
      const [sJson, skuJson, matJson] = await Promise.all([sRes.json(), skuRes.json(), matRes.json()]);
      if (!sRes.ok || !sJson?.ok) throw new Error(sJson?.error || "Failed to load summary");
      if (!skuRes.ok || !skuJson?.ok) throw new Error(skuJson?.error || "Failed to load SKU forecast");
      if (!matRes.ok || !matJson?.ok) throw new Error(matJson?.error || "Failed to load material forecast");
      setSummary(sJson.data || {});
      setSkuRows(Array.isArray(skuJson?.data?.rows) ? skuJson.data.rows : []);
      setMaterialRows(Array.isArray(matJson?.data?.rows) ? matJson.data.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load planning");
    } finally {
      setLoading(false);
    }
  }

  const filteredSkus = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skuRows;
    return skuRows.filter((r) => `${r.sku} ${r.product} ${r.size || ""} ${r.color || ""}`.toLowerCase().includes(q));
  }, [search, skuRows]);

  return (
    <MfgLayout title="Plan">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value) === 60 ? 60 : 30)}>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
        </select>
        <select value={bucket} onChange={(e) => setBucket(e.target.value === "DAY" ? "DAY" : "WEEK")}>
          <option value="WEEK">Weekly</option>
          <option value="DAY">Daily</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU" style={{ minWidth: 220 }} />
      </div>

      {error ? <div style={{ marginBottom: 10, color: "#991b1b" }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <Tile label="Missing BOM SKUs" value={summary?.sku_missing_bom_count || 0} tone="amber" />
        <Tile label="Projected Material Shortages" value={summary?.projected_shortage_materials_count || 0} tone="red" />
        <Tile label="Overdue PO Lines" value={summary?.overdue_po_lines_count || 0} tone="red" />
        <Tile label="Top SKU Demand" value={summary?.top_skus_next_horizon?.[0]?.demand_qty || 0} tone="blue" />
      </div>

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Production Forecast</h3>
        {loading ? <div>Loading…</div> : (
          <table style={tableStyle}>
            <thead><tr>{["SKU", "Total Open", "Overdue", "Next Bucket", "BOM", "WIP"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {filteredSkus.map((row) => (
                <SkuMainRow key={row.variant_id} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ ...cardStyle, marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Material Plan</h3>
        {loading ? <div>Loading…</div> : (
          <table style={tableStyle}>
            <thead><tr>{["Material", "On hand", "Next Bucket", "First Shortage", "Reorder Qty", "Order By"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {materialRows.map((row) => {
                const next = row.buckets?.[0];
                const danger = !!row.first_shortage_bucket_start;
                return (
                  <tr key={row.material_id} style={danger ? { background: "#fef2f2" } : undefined}>
                    <td style={tdStyle}>{row.material_name} <span style={{ color: "#64748b" }}>({row.uom})</span></td>
                    <td style={tdStyle}>{row.on_hand}</td>
                    <td style={tdStyle}>{next?.demand_qty || 0}</td>
                    <td style={tdStyle}>{row.first_shortage_bucket_start || "-"}</td>
                    <td style={tdStyle}>{row.recommended_reorder_qty}</td>
                    <td style={tdStyle}>{row.recommended_order_by_date || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </MfgLayout>
  );
}

function SkuMainRow({ row }: { row: SkuRow }) {
  const [open, setOpen] = useState(false);
  const next = row.buckets?.[0];
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
        <td style={tdStyle}>{row.sku} <span style={{ color: "#64748b" }}>{row.size || ""} {row.color || ""}</span></td>
        <td style={tdStyle}>{row.total_open_qty}</td>
        <td style={tdStyle}>{row.overdue_qty}</td>
        <td style={tdStyle}>{next?.qty || 0}</td>
        <td style={tdStyle}><span style={{ color: row.bom_status === "MISSING" ? "#b45309" : "#166534" }}>{row.bom_status}</span></td>
        <td style={tdStyle}>{row.wip_hint_qty || 0}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} style={{ ...tdStyle, background: "#f8fafc" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(row.buckets || []).map((b) => (
                <span key={b.bucket_start} style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "3px 8px", fontSize: 12 }}>{b.bucket_start}: {b.qty || 0}</span>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "blue" }) {
  const bg = tone === "red" ? "#fef2f2" : tone === "amber" ? "#fffbeb" : "#eff6ff";
  return <div style={{ background: bg, border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 12, color: "#64748b" }}>{label}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div></div>;
}

const cardStyle: CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse" };
const thStyle: CSSProperties = { textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", color: "#475569", fontWeight: 600 };
const tdStyle: CSSProperties = { padding: "10px 6px", borderBottom: "1px solid #f1f5f9", fontSize: 13 };
