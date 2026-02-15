import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useRouter } from "next/router";
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
  getAttendancePayrollSummary,
  type AttendancePayrollSummaryRow,
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

const tableHeaderStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
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

export default function AttendancePayrollSummaryReportPage() {
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
  const [payrollRunId, setPayrollRunId] = useState("");
  const [runs, setRuns] = useState<PayrollRunOption[]>([]);
  const [rows, setRows] = useState<AttendancePayrollSummaryRow[]>([]);

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
    if (!ctx?.companyId || !canView || !payrollRunId) {
      setRows([]);
      return;
    }
    loadReport(payrollRunId);
  }, [ctx?.companyId, canView, payrollRunId]);

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

    const runList = (data as PayrollRunOption[]) || [];
    setRuns(runList);
    if (!payrollRunId && runList.length > 0) {
      setPayrollRunId(runList[0].id);
    }
  }

  async function loadReport(runId: string) {
    setDataLoading(true);
    setError("");

    try {
      const data = await getAttendancePayrollSummary(runId);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report.");
      setRows([]);
    } finally {
      setDataLoading(false);
    }
  }

  const selectedRun = runs.find((run) => run.id === payrollRunId);
  const periodLabel = selectedRun
    ? `${selectedRun.year}-${String(selectedRun.month).padStart(2, "0")}`
    : "";

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.present += row.present_days ?? 0;
        acc.leave += row.leave_days ?? 0;
        acc.paid += row.paid_days ?? 0;
        acc.ot += row.manual_ot_hours ?? 0;
        acc.gross += row.gross_pay ?? 0;
        acc.net += row.net_pay ?? 0;
        return acc;
      },
      { present: 0, leave: 0, paid: 0, ot: 0, gross: 0, net: 0 }
    );
  }, [rows]);

  function formatNumber(value: number | null | undefined, fractionDigits = 2) {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  function formatCurrency(value: number | null | undefined) {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function handleExport() {
    if (rows.length === 0) return;
    const columns: CsvColumn<AttendancePayrollSummaryRow>[] = [
      { header: "Employee Code", accessor: (row) => row.employee_code ?? "" },
      { header: "Employee Name", accessor: (row) => row.employee_name ?? "" },
      { header: "Designation", accessor: (row) => row.designation_name ?? "" },
      { header: "Period Start", accessor: (row) => row.period_start ?? "" },
      { header: "Period End", accessor: (row) => row.period_end ?? "" },
      { header: "Calendar Days", accessor: (row) => row.calendar_days ?? "" },
      { header: "Present Days", accessor: (row) => row.present_days ?? "" },
      { header: "Leave Days", accessor: (row) => row.leave_days ?? "" },
      { header: "Paid Days", accessor: (row) => row.paid_days ?? "" },
      { header: "Absent Days", accessor: (row) => row.absent_days ?? "" },
      { header: "Manual OT Hours", accessor: (row) => row.manual_ot_hours ?? "" },
      { header: "Gross Pay", accessor: (row) => row.gross_pay ?? "" },
      { header: "Net Pay", accessor: (row) => row.net_pay ?? "" },
    ];
    const filename = `attendance-payroll-summary-${periodLabel || "run"}.csv`;
    downloadCsv(filename, columns, rows);
  }

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading attendance payroll summary…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Attendance → Payroll Summary</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR Reports</p>
          <h1 style={h1Style}>Attendance → Payroll Summary</h1>
          <p style={subtitleStyle}>
            Compare payroll run items with attendance totals. Overtime stays manual in payroll.
          </p>
        </div>
      </header>
      <ReportBrandHeader />

      <section style={cardStyle}>
        <div style={filterGridStyle}>
          <div>
            <label style={labelStyle}>Payroll Run</label>
            <select
              style={inputStyle}
              value={payrollRunId}
              onChange={(event) => setPayrollRunId(event.target.value)}
            >
              <option value="">Select a run</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.year}-{String(run.month).padStart(2, "0")} ({run.status ?? "draft"})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
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
        {selectedRun ? (
          <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
            Period: {selectedRun.year}-{String(selectedRun.month).padStart(2, "0")}
          </p>
        ) : null}
      </section>

      <section style={cardStyle}>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {dataLoading ? <p>Loading report…</p> : null}
        {!dataLoading && rows.length === 0 ? <p>No rows for the selected payroll run.</p> : null}

        {rows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Employee</th>
                  <th style={tableHeaderStyle}>Designation</th>
                  <th style={tableHeaderStyle}>Period</th>
                  <th style={tableHeaderStyle}>Present</th>
                  <th style={tableHeaderStyle}>Leave</th>
                  <th style={tableHeaderStyle}>Paid</th>
                  <th style={tableHeaderStyle}>Absent</th>
                  <th style={tableHeaderStyle}>Manual OT</th>
                  <th style={tableHeaderStyle}>Gross Pay</th>
                  <th style={tableHeaderStyle}>Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee_id}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{row.employee_name ?? "Unnamed"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{row.employee_code ?? "-"}</div>
                    </td>
                    <td style={tableCellStyle}>{row.designation_name ?? "-"}</td>
                    <td style={tableCellStyle}>
                      {row.period_start ?? "-"} → {row.period_end ?? "-"}
                    </td>
                    <td style={tableCellStyle}>{formatNumber(row.present_days)}</td>
                    <td style={tableCellStyle}>{formatNumber(row.leave_days)}</td>
                    <td style={tableCellStyle}>{formatNumber(row.paid_days)}</td>
                    <td style={tableCellStyle}>{formatNumber(row.absent_days)}</td>
                    <td style={tableCellStyle}>{formatNumber(row.manual_ot_hours)}</td>
                    <td style={tableCellStyle}>{formatCurrency(row.gross_pay)}</td>
                    <td style={tableCellStyle}>{formatCurrency(row.net_pay)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#f8fafc", fontWeight: 600 }}>
                  <td style={tableCellStyle} colSpan={3}>
                    Totals
                  </td>
                  <td style={tableCellStyle}>{formatNumber(totals.present)}</td>
                  <td style={tableCellStyle}>{formatNumber(totals.leave)}</td>
                  <td style={tableCellStyle}>{formatNumber(totals.paid)}</td>
                  <td style={tableCellStyle}>-</td>
                  <td style={tableCellStyle}>{formatNumber(totals.ot)}</td>
                  <td style={tableCellStyle}>{formatCurrency(totals.gross)}</td>
                  <td style={tableCellStyle}>{formatCurrency(totals.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      </div>
    </>
  );
}

const headerStyle: CSSProperties = {
  ...pageHeaderStyle,
  marginBottom: 20,
};

const cardStyle: CSSProperties = {
  ...sharedCardStyle,
};

const filterGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 1fr) auto",
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
