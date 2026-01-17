import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Rfq = {
  id: string;
  rfq_no: string;
  vendor_id: string;
  status: string;
  requested_on: string;
  needed_by: string | null;
  created_at: string;
};

type Vendor = {
  id: string;
  legal_name: string;
};

export default function RfqListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      setLoading(true);
      await loadData(ctx.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, statusFilter, vendorFilter, search]);

  async function loadData(companyId: string, isActiveFetch = true) {
    setError("");
    let query = supabase
      .from("erp_rfq")
      .select("id, rfq_no, vendor_id, status, requested_on, needed_by, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    if (vendorFilter) {
      query = query.eq("vendor_id", vendorFilter);
    }

    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      query = query.ilike("rfq_no", `%${trimmedSearch}%`);
    }

    const [rfqRes, vendorRes] = await Promise.all([
      query,
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
    ]);

    if (rfqRes.error || vendorRes.error) {
      if (isActiveFetch) {
        setError(rfqRes.error?.message || vendorRes.error?.message || "Failed to load RFQs.");
      }
      return;
    }

    if (isActiveFetch) {
      setRfqs((rfqRes.data || []) as Rfq[]);
      setVendors((vendorRes.data || []) as Vendor[]);
    }
  }

  const vendorMap = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.legal_name])), [vendors]);

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>RFQs</h1>
            <p style={subtitleStyle}>Track vendor enquiries before creating purchase orders.</p>
          </div>
          <Link href="/erp/inventory/rfqs/new" style={primaryButtonStyle}>
            New RFQ
          </Link>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section
          style={{
            ...cardStyle,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            Status
            <select style={inputStyle} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All</option>
              <option value="draft">draft</option>
              <option value="sent">sent</option>
              <option value="closed">closed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            Vendor
            <select style={inputStyle} value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.legal_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            Search RFQ No
            <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>RFQ</th>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Requested On</th>
                <th style={tableHeaderCellStyle}>Needed By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    Loading RFQs...
                  </td>
                </tr>
              ) : rfqs.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No RFQs found.
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/rfqs/${rfq.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                        {rfq.rfq_no}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{vendorMap.get(rfq.vendor_id) || "—"}</td>
                    <td style={tableCellStyle}>{rfq.status}</td>
                    <td style={tableCellStyle}>{new Date(rfq.requested_on).toLocaleDateString()}</td>
                    <td style={tableCellStyle}>{rfq.needed_by ? new Date(rfq.needed_by).toLocaleDateString() : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
