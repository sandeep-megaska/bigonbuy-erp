import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ReportBrandHeader from "../../../../components/erp/ReportBrandHeader";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { downloadCsv, type CsvColumn } from "../../../../lib/erp/exportCsv";
import {
  getAttendanceExceptions,
  type AttendanceExceptionRow,
} from "../../../../lib/erp/reports";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type PayrollRunOption = {
  id: string;
  year: number;
  month: number;
  status: string | null;
};


const tableCellStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
  fontSize: 13,
};
const inputStyle: CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: "1px solid #d1d5db",
  width: "100%",
};

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function AttendanceExceptionsReportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [{ start, end }, setRange] = useState(() => getMonthBounds(new Date()));
  const [payrollRunId, setPayrollRunId] = useState("");
  const [runs, setRuns] = useState<PayrollRunOption[]>([]);
  const [rows, setRows] = useState<AttendanceExceptionRow[]>([]);
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({});

  const canView = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx?.roleKey]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      const canViewNow = accessState.isManager || isHr(context.roleKey);

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (!canViewNow && context.roleKey) {
        setError("Only HR or Admin users can access this report.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !canView) return;
    loadPayrollRuns();
  }, [ctx?.companyId, canView]);

  useEffect(() => {
    if (!ctx?.companyId || !canView) return;
    loadReport();
  }, [ctx?.companyId, canView, start, end, payrollRunId]);

  async function loadPayrollRuns() {
    const { data, error: runError } = await supabase
      .from("erp_payroll_runs")
      .select("id, year, month, status")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (runError) {
      setError(runError.message);
      return;
    }

    setRuns((data as PayrollRunOption[]) || []);
  }

  async function loadReport() {
    setDataLoading(true);
    setError("");

    try {
      const data = await getAttendanceExceptions({
        start,
        end,
        runId: payrollRunId || null,
      });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report.");
      setRows([]);
    } finally {
      setDataLoading(false);
    }
  }

  const groupedIssues = useMemo(() => {
    return rows.reduce<Record<string, AttendanceExceptionRow[]>>((acc, row) => {
      const key = row.issue_key ?? "unknown";
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [rows]);

  function toggleIssue(key: string) {
    setExpandedIssues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleExport() {
    if (rows.length === 0) return;
    const columns: CsvColumn<AttendanceExceptionRow>[] = [
      { header: "Issue", accessor: (row) => row.issue_key ?? "" },
      { header: "Employee Code", accessor: (row) => row.employee_code ?? "" },
      { header: "Employee Name", accessor: (row) => row.employee_name ?? "" },
      { header: "Details", accessor: (row) => row.details ?? "" },
    ];
    const filename = `attendance-exceptions-${start}-to-${end}.csv`;
    downloadCsv(filename, columns, rows);
  }

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading attendance exceptions…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Attendance Exceptions</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>HR Reports</p>
            <h1 style={h1Style}>Attendance Exceptions</h1>
            <p style={subtitleStyle}>
              Highlight attendance gaps, overages, and payroll mismatches.
            </p>
          </div>
        </header>
        <ReportBrandHeader />

      <section style={cardStyle}>
        <div style={filterGridStyle}>
          <div>
            <label style={labelStyle}>Start date</label>
            <input
              type="date"
              value={start}
              style={inputStyle}
              onChange={(event) => setRange((prev) => ({ ...prev, start: event.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>End date</label>
            <input
              type="date"
              value={end}
              style={inputStyle}
              onChange={(event) => setRange((prev) => ({ ...prev, end: event.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Payroll Run (optional)</label>
            <select
              style={inputStyle}
              value={payrollRunId}
              onChange={(event) => setPayrollRunId(event.target.value)}
            >
              <option value="">All payroll runs</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.year}-{String(run.month).padStart(2, "0")} ({run.status ?? "draft"})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={handleExport}
              disabled={!rows.length}
            >
              Export CSV
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {dataLoading ? <p>Loading report…</p> : null}
        {!dataLoading && rows.length === 0 ? <p>No exceptions for the selected period.</p> : null}

        {Object.entries(groupedIssues).map(([issueKey, issueRows]) => (
          <div key={issueKey} style={issueCardStyle}>
            <div style={issueHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>{issueKey.replace(/_/g, " ")}</h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                  {issueRows.length} affected employee{issueRows.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => toggleIssue(issueKey)}
              >
                {expandedIssues[issueKey] ? "Hide" : "View"} details
              </button>
            </div>
            {expandedIssues[issueKey] ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderStyle}>Employee</th>
                      <th style={tableHeaderStyle}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issueRows.map((row, index) => (
                      <tr key={`${row.employee_id}-${issueKey}-${index}`}>
                        <td style={tableCellStyle}>
                          <div style={{ fontWeight: 600 }}>{row.employee_name ?? "Unnamed"}</div>
                          <div style={{ color: "#6b7280", fontSize: 12 }}>{row.employee_code ?? "-"}</div>
                        </td>
                        <td style={tableCellStyle}>{row.details ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ))}
      </section>
      </div>
    </ErpShell>
  );
}

const headerStyle: CSSProperties = {
  ...pageHeaderStyle,
  marginBottom: 20,
};
const tableHeaderStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
};

const cardStyle: CSSProperties = {
  ...sharedCardStyle,
};

const filterGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
  alignItems: "end",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
};

const issueCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  background: "#f8fafc",
};

const issueHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 12,
};
