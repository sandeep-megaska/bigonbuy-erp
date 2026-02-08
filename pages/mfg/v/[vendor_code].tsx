import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import MfgLayout from "../../../components/mfg/MfgLayout";

type DashboardData = {
  tiles: {
    open_pos: number;
    pending_deliveries: number;
    quality_issues: number;
  };
  recent_activity: Array<{ id: string; label: string; at: string }>;
};

export default function VendorDashboardPage() {
  const router = useRouter();
  const { vendor_code } = router.query;
  const vendorCode = typeof vendor_code === "string" ? vendor_code.toUpperCase() : "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!vendorCode) return;
    let active = true;

    (async () => {
      const res = await fetch(
        `/api/mfg/vendor/dashboard?vendor_code=${encodeURIComponent(vendorCode)}`
      );
      const payload = await res.json();
      if (!active) return;

      if (!res.ok || !payload.ok) {
        setError(payload.error || "Failed to load dashboard");
        setLoading(false);
        return;
      }

      setData({
        tiles: payload.data.tiles,
        recent_activity: payload.data.recent_activity,
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [vendorCode]);

  return (
    <MfgLayout title="Vendor Dashboard" requestedVendorCode={vendorCode}>
      {loading ? <div>Loading…</div> : null}
      {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}

      {data ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Tile title="Open POs" value={data.tiles.open_pos} />
            <Tile title="Pending Deliveries" value={data.tiles.pending_deliveries} />
            <Tile title="Quality Issues" value={data.tiles.quality_issues} />
          </div>
          <div
            style={{
              marginTop: 20,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Recent Activity</h3>
            <table style={{ width: "100%" }}>
              <tbody>
                {data.recent_activity.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td style={{ textAlign: "right", color: "#6b7280" }}>{item.at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </MfgLayout>
  );
}

function Tile({ title, value }: { title: string; value: number }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div style={{ color: "#6b7280", fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
