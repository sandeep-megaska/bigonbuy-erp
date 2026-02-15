import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Quote = {
  id: string;
  quote_no: string;
  rfq_id: string;
  vendor_id: string;
  status: string;
  received_on: string;
  validity_until: string | null;
  created_at: string;
};

type Vendor = {
  id: string;
  legal_name: string;
};

type Rfq = {
  id: string;
  rfq_no: string;
};

export default function QuoteListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
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
      .from("erp_vendor_quotes")
      .select("id, quote_no, rfq_id, vendor_id, status, received_on, validity_until, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    if (vendorFilter) {
      query = query.eq("vendor_id", vendorFilter);
    }

    const [quoteRes, vendorRes] = await Promise.all([
      query,
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
    ]);

    if (quoteRes.error || vendorRes.error) {
      if (isActiveFetch) {
        setError(quoteRes.error?.message || vendorRes.error?.message || "Failed to load quotes.");
      }
      return;
    }

    const quoteRows = (quoteRes.data || []) as Quote[];
    const rfqIds = Array.from(new Set(quoteRows.map((quote) => quote.rfq_id).filter(Boolean)));
    const rfqRes = rfqIds.length
      ? await supabase.from("erp_rfq").select("id, rfq_no").eq("company_id", companyId).in("id", rfqIds)
      : { data: [], error: null };

    if (rfqRes.error) {
      if (isActiveFetch) setError(rfqRes.error.message);
      return;
    }

    if (isActiveFetch) {
      setQuotes(quoteRows);
      setVendors((vendorRes.data || []) as Vendor[]);
      setRfqs((rfqRes.data || []) as Rfq[]);
    }
  }

  const vendorMap = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.legal_name])), [vendors]);
  const rfqMap = useMemo(() => new Map(rfqs.map((rfq) => [rfq.id, rfq.rfq_no])), [rfqs]);
  const filteredQuotes = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return quotes;
    return quotes.filter((quote) => {
      const rfqNo = rfqMap.get(quote.rfq_id) || "";
      return (
        quote.quote_no.toLowerCase().includes(trimmed) ||
        rfqNo.toLowerCase().includes(trimmed)
      );
    });
  }, [quotes, search, rfqMap]);

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>Vendor Quotes</h1>
            <p style={subtitleStyle}>Capture vendor quotations against RFQs.</p>
          </div>
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
              <option value="received">received</option>
              <option value="accepted">accepted</option>
              <option value="rejected">rejected</option>
              <option value="expired">expired</option>
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
            Search Quote / RFQ
            <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Quote</th>
                <th style={tableHeaderCellStyle}>RFQ</th>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Received On</th>
                <th style={tableHeaderCellStyle}>Validity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    Loading quotes...
                  </td>
                </tr>
              ) : filteredQuotes.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No quotes found.
                  </td>
                </tr>
              ) : (
                filteredQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/quotes/${quote.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                        {quote.quote_no}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{rfqMap.get(quote.rfq_id) || "—"}</td>
                    <td style={tableCellStyle}>{vendorMap.get(quote.vendor_id) || "—"}</td>
                    <td style={tableCellStyle}>{quote.status}</td>
                    <td style={tableCellStyle}>{new Date(quote.received_on).toLocaleDateString()}</td>
                    <td style={tableCellStyle}>
                      {quote.validity_until ? new Date(quote.validity_until).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
