import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import MfgLayout from "../../../components/mfg/MfgLayout";

type Row = { asn_id: string; carton_no: number; sku: string; qty_packed: number };

export default function MfgAsnPackingListPage() {
  const router = useRouter();
  const asnId = typeof router.query.asn_id === "string" ? router.query.asn_id : "";
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!asnId) return;
    void (async () => {
      const res = await fetch(`/api/mfg/asn/packing-list?asn_id=${asnId}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Failed to load packing list");
        return;
      }
      setRows(json.data.items || []);
    })();
  }, [asnId]);

  const grouped = rows.reduce<Record<string, Row[]>>((acc, row) => {
    const k = `Box-${row.carton_no}`;
    acc[k] = acc[k] || [];
    acc[k].push(row);
    return acc;
  }, {});

  return (
    <MfgLayout title="Printable Packing List">
      <h2>ASN Packing List</h2>
      {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}
      {Object.keys(grouped).length === 0 ? <div>No packed lines yet.</div> : null}
      {Object.entries(grouped).map(([box, boxRows]) => (
        <div key={box} style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 8, padding: 10, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>{box}</h3>
          <table style={{ width: "100%" }}>
            <thead><tr><th align="left">SKU</th><th align="right">Qty</th></tr></thead>
            <tbody>
              {boxRows.map((r) => (
                <tr key={`${box}-${r.sku}`}><td>{r.sku}</td><td align="right">{r.qty_packed}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <button onClick={() => window.print()}>Print</button>
      </div>
    </MfgLayout>
  );
}
