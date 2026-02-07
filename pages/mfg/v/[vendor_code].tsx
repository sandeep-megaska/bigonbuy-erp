import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function VendorDashboardPage() {
  const router = useRouter();
  const { vendor_code } = router.query;
  const vendorCode = typeof vendor_code === "string" ? vendor_code.toUpperCase() : "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!vendorCode) return;
    let active = true;
    (async () => {
      const meRes = await fetch("/api/mfg/auth/me");
      if (!meRes.ok) {
        router.replace("/mfg/login");
        return;
      }
      const meData = await meRes.json();
      if (!active) return;
      if (meData?.must_reset_password) {
        router.replace("/mfg/reset-password");
        return;
      }

      const res = await fetch(`/api/mfg/vendor/dashboard?vendor_code=${encodeURIComponent(vendorCode)}`);
      const payload = await res.json();
      if (!active) return;
      if (!res.ok || !payload.ok) {
        setError(payload.error || "Failed to load dashboard");
        setLoading(false);
        return;
      }
      setData(payload.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [vendorCode, router]);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>Manufacturer Portal</div>
            <h1 style={{ margin: "4px 0" }}>{data?.vendor?.legal_name || "Vendor Dashboard"}</h1>
            <div style={{ color: "#6b7280" }}>{data?.vendor?.vendor_code || vendorCode}</div>
          </div>
          <button onClick={async () => { await fetch('/api/mfg/auth/logout', { method: 'POST' }); router.replace('/mfg/login'); }}>Sign Out</button>
        </header>

        {loading ? <div style={{ marginTop: 20 }}>Loading…</div> : null}
        {error ? <div style={{ marginTop: 20, color: "#991b1b" }}>{error}</div> : null}

        {data ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 20 }}>
              <Tile title="Open POs" value={data.tiles.open_pos} />
              <Tile title="Pending Deliveries" value={data.tiles.pending_deliveries} />
              <Tile title="Quality Issues" value={data.tiles.quality_issues} />
            </div>
            <div style={{ marginTop: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Recent Activity</h3>
              <table style={{ width: "100%" }}>
                <tbody>
                  {data.recent_activity.map((item: any) => (
                    <tr key={item.id}><td>{item.label}</td><td style={{ textAlign: "right", color: "#6b7280" }}>{item.at}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ title, value }: { title: string; value: number }) {
  return <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}><div style={{ color: "#6b7280", fontSize: 12 }}>{title}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div></div>;
}
