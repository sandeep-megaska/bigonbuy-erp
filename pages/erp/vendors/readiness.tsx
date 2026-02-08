import { useEffect, useMemo, useState } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";
import { useRouter } from "next/router";

type ReadinessStatus = "green" | "amber" | "red";

type ReadinessRow = {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string | null;
  readiness_status: ReadinessStatus;
  reasons: string[] | null;
  open_po_lines: number;
  bom_missing_skus: number;
  shortage_materials: number;
};

export default function VendorReadinessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ReadinessRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const ctx = await getCompanyContext(session);
      if (!ctx?.companyId) {
        if (active) {
          setError(ctx?.membershipError || "No active company membership found for this user.");
          setLoading(false);
        }
        return;
      }

      const { data, error: rpcError } = await supabase.rpc("erp_vendor_readiness_list_v1", {
        p_company_id: ctx.companyId,
        p_from: null,
        p_to: null,
      });

      if (!active) return;
      if (rpcError) {
        setError(rpcError.message || "Failed to load vendor readiness");
        setLoading(false);
        return;
      }

      setRows((Array.isArray(data) ? data : []) as ReadinessRow[]);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.readiness_status] += 1;
        return acc;
      },
      { green: 0, amber: 0, red: 0 } as Record<ReadinessStatus, number>,
    );
  }, [rows]);

  return (
    <ErpShell>
      <main style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <h1 style={h1Style}>Vendor Readiness</h1>
            <p style={subtitleStyle}>Green / Amber / Red readiness based on open POs, BOM coverage, and projected shortages.</p>
          </div>
        </header>

        <section style={cardStyle}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <StatusPill status="green" label={`Green: ${counts.green}`} />
            <StatusPill status="amber" label={`Amber: ${counts.amber}`} />
            <StatusPill status="red" label={`Red: ${counts.red}`} />
          </div>

          {loading ? <div>Loading readiness…</div> : null}
          {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

          {!loading && !error ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Open PO lines</th>
                    <th style={tableHeaderCellStyle}>BOM missing</th>
                    <th style={tableHeaderCellStyle}>Shortages</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Reasons</th>
                    <th style={tableHeaderCellStyle}>View</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.vendor_id}>
                      <td style={tableCellStyle}>{row.vendor_name}</td>
                      <td style={tableCellStyle}>{row.open_po_lines}</td>
                      <td style={tableCellStyle}>{row.bom_missing_skus}</td>
                      <td style={tableCellStyle}>{row.shortage_materials}</td>
                      <td style={tableCellStyle}>
                        <StatusPill status={row.readiness_status} label={row.readiness_status.toUpperCase()} />
                      </td>
                      <td style={tableCellStyle}>{(row.reasons || []).join("; ") || "—"}</td>
                      <td style={tableCellStyle}>
                        <button onClick={() => router.push("/erp/inventory/vendors")}>View</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={7}>No vendors found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </main>
    </ErpShell>
  );
}

function StatusPill({ status, label }: { status: ReadinessStatus; label: string }) {
  const styleMap: Record<ReadinessStatus, { bg: string; fg: string }> = {
    green: { bg: "#dcfce7", fg: "#166534" },
    amber: { bg: "#fef3c7", fg: "#92400e" },
    red: { bg: "#fee2e2", fg: "#991b1b" },
  };

  const st = styleMap[status];
  return (
    <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}
