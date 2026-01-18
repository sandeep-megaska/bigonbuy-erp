import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { downloadCsv, type CsvColumn } from "../../../../lib/erp/exportCsv";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import { useGrnRegister, type GrnRegisterRow } from "../../../../lib/erp/financeBridge";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

function defaultMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: formatDateInput(start), end: formatDateInput(now) };
}

type VendorOption = { id: string; legal_name: string };

export default function GrnRegisterPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [from, setFrom] = useState(() => defaultMonthRange().start);
  const [to, setTo] = useState(() => defaultMonthRange().end);
  const [vendorId, setVendorId] = useState<string>("");

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!router.isReady) return;
    if (typeof router.query.from === "string") {
      setFrom(router.query.from);
    }
    if (typeof router.query.to === "string") {
      setTo(router.query.to);
    }
  }, [router.isReady, router.query.from, router.query.to]);

  useEffect(() => {
    let active = true;

    async function loadVendors() {
      if (!ctx?.companyId) return;

      const { data, error: loadError } = await supabase
        .from("erp_vendors")
        .select("id, legal_name")
        .eq("company_id", ctx.companyId)
        .order("legal_name");

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load vendors.");
        return;
      }

      setVendors((data || []) as VendorOption[]);
    }

    loadVendors();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const { data, loading: dataLoading, error: dataError } = useGrnRegister({
    companyId: ctx?.companyId ?? null,
    from,
    to,
    vendorId: vendorId || null,
  });

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }),
    []
  );

  function handleExport() {
    if (data.length === 0) return;
    const columns: CsvColumn<GrnRegisterRow>[] = [
      { header: "GRN Date", accessor: (row) => row.grn_date },
      { header: "GRN Reference", accessor: (row) => row.reference ?? "" },
      { header: "Vendor", accessor: (row) => row.vendor_name ?? "" },
      { header: "Status", accessor: (row) => row.status },
      { header: "Total Qty", accessor: (row) => `${row.total_qty}` },
      { header: "Total Cost", accessor: (row) => (row.total_cost ?? "").toString() },
      { header: "Missing Cost Count", accessor: (row) => `${row.cost_missing_count}` },
    ];
    downloadCsv(`grn-register-${from}-to-${to}.csv`, columns, data);
  }

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading GRN register…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Bridge"
            title="GRN Register"
            description="GRN register for CA review."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Bridge"
          title="GRN Register"
          description="Goods receipt notes with totals, cost visibility, and missing flags."
          rightActions={
            <Link href="/erp/finance/bridge" style={linkButtonStyle}>
              Back to Bridge
            </Link>
          }
        />

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <div>
              <label style={labelStyle}>From date</label>
              <input
                type="date"
                value={from}
                style={inputStyle}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>To date</label>
              <input
                type="date"
                value={to}
                style={inputStyle}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Vendor</label>
              <select
                value={vendorId}
                style={inputStyle}
                onChange={(event) => setVendorId(event.target.value)}
              >
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button type="button" style={secondaryButtonStyle} onClick={handleExport} disabled={!data.length}>
                Export CSV
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
          {dataError ? <p style={{ color: "#b91c1c" }}>{dataError}</p> : null}
          {dataLoading ? <p>Loading GRN register…</p> : null}
          {!dataLoading && data.length === 0 ? (
            <p style={subtitleStyle}>No GRNs found for the selected period.</p>
          ) : null}

          {data.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>GRN Date</th>
                    <th style={tableHeaderCellStyle}>GRN Reference</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Total Qty</th>
                    <th style={tableHeaderCellStyle}>Total Cost</th>
                    <th style={tableHeaderCellStyle}>Missing Costs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.grn_id} style={row.cost_missing_count > 0 ? missingRowStyle : undefined}>
                      <td style={tableCellStyle}>{row.grn_date}</td>
                      <td style={tableCellStyle}>{row.reference ?? "—"}</td>
                      <td style={tableCellStyle}>{row.vendor_name ?? "—"}</td>
                      <td style={tableCellStyle}>{row.status}</td>
                      <td style={tableCellStyle}>{row.total_qty}</td>
                      <td style={tableCellStyle}>
                        {row.total_cost == null ? "—" : currencyFormatter.format(row.total_cost)}
                      </td>
                      <td style={tableCellStyle}>{row.cost_missing_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const missingRowStyle = {
  backgroundColor: "#fef2f2",
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
