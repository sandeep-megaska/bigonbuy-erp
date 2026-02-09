import { useEffect, useState } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

type AsnRow = {
  asn_id: string;
  vendor_name: string;
  po_number: string;
  status: string;
  dispatch_date: string;
  eta_date: string | null;
  total_qty: number;
  cartons_count: number;
};

export default function ErpVendorAsnsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [items, setItems] = useState<AsnRow[]>([]);
  const [vendors, setVendors] = useState<Array<{ id: string; legal_name: string }>>([]);
  const [status, setStatus] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;
      setToken(session.access_token);
      const ctx = await getCompanyContext(session);
      if (!ctx.companyId) return;
      const vendorRes = await supabase.from("erp_vendors").select("id, legal_name").eq("company_id", ctx.companyId).order("legal_name");
      if (!vendorRes.error) setVendors((vendorRes.data || []) as Array<{ id: string; legal_name: string }>);
      await load(session.access_token, "", "", "", "");
    })();
  }, [router]);

  async function load(accessToken = token, qStatus = status, qVendor = vendorId, qFrom = from, qTo = to) {
    const params = new URLSearchParams();
    if (qStatus) params.set("status", qStatus);
    if (qVendor) params.set("vendor_id", qVendor);
    if (qFrom) params.set("from", qFrom);
    if (qTo) params.set("to", qTo);

    const res = await fetch(`/api/mfg/internal/asns/list?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to load ASNs");
    setItems(json.data.items || []);
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={{ padding: 24 }}>
        <h1>Vendor ASNs</h1>
        {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, margin: "12px 0" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All Status</option><option value="DRAFT">DRAFT</option><option value="SUBMITTED">SUBMITTED</option><option value="CANCELLED">CANCELLED</option></select>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">All Vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.legal_name}</option>)}</select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button onClick={() => load()}>Apply</button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
          <thead><tr><th>Vendor</th><th>PO</th><th>Status</th><th>Dispatch</th><th>ETA</th><th>Total Qty</th><th>Cartons</th></tr></thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.asn_id}><td>{row.vendor_name}</td><td>{row.po_number}</td><td>{row.status}</td><td>{row.dispatch_date}</td><td>{row.eta_date || "—"}</td><td>{row.total_qty}</td><td>{row.cartons_count}</td></tr>
            ))}
            {items.length === 0 ? <tr><td colSpan={7}>No ASNs found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </ErpShell>
  );
}
