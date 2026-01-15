import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { downloadCsv, type CsvColumn } from "../../../../lib/erp/exportCsv";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type PayrollRunOption = {
  id: string;
  year: number;
  month: number;
  status: string | null;
};

type ReportRow = {
  company_id: string | null;
  payroll_run_id: string | null;
  month: string | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  present_days: number | null;
  leave_paid_days: number | null;
  leave_unpaid_days: number | null;
  holiday_days: number | null;
  weekly_off_days: number | null;
  absent_days: number | null;
  unmarked_days: number | null;
  payable_days_suggested: number | null;
  lop_days_suggested: number | null;
  attendance_period_status: string | null;
  payable_days_effective: number | null;
  lop_days_effective: number | null;
  gross_pay: number | null;
  deductions: number | null;
  net_pay: number | null;
  payroll_finalized: boolean | null;
  payslip_generated: boolean | null;
  attendance_synced: boolean | null;
  attendance_overridden: boolean | null;
  attendance_unfrozen_warning: boolean | null;
};

const tableHeaderStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
};

const tableCellStyle = { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top", fontSize: 13 };
const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer", background: "#fff" };

export default function AttendancePayrollReportPage() {
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
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [payrollRunId, setPayrollRunId] = useState("");
  const [runs, setRuns] = useState<PayrollRunOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);

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
  }, [router, canView]);

  useEffect(() => {
    if (!ctx?.companyId || !canView) return;
    loadPayrollRuns();
  }, [ctx?.companyId, canView, monthValue]);

  useEffect(() => {
    if (!ctx?.companyId || !canView) return;
    loadReport();
  }, [ctx?.companyId, canView, monthValue, payrollRunId]);

  async function loadPayrollRuns() {
    const [year, month] = monthValue.split("-");
    const yearValue = Number(year);
    const monthValueNumber = Number(month);
    if (!yearValue || !monthValueNumber) return;

    const { data, error: runError } = await supabase
      .from("erp_payroll_runs")
      .select("id, year, month, status")
      .eq("year", yearValue)
      .eq("month", monthValueNumber)
      .order("id", { ascending: false });

    if (runError) {
      setError(runError.message);
      return;
    }

    setRuns((data as PayrollRunOption[]) || []);
  }

  async function loadReport() {
    setDataLoading(true);
    setError("");
    const monthStart = `${monthValue}-01`;
    let query = supabase
      .from("erp_attendance_payroll_reconciliation_v")
      .select(
        "company_id, payroll_run_id, month, employee_id, employee_code, employee_name, present_days, leave_paid_days, leave_unpaid_days, holiday_days, weekly_off_days, absent_days, unmarked_days, payable_days_suggested, lop_days_suggested, attendance_period_status, payable_days_effective, lop_days_effective, gross_pay, deductions, net_pay, payroll_finalized, payslip_generated, attendance_synced, attendance_overridden, attendance_unfrozen_warning"
      )
      .eq("month", monthStart)
      .not("employee_id", "is", null)
      .order("employee_name", { ascending: true });

    if (payrollRunId) {
      query = query.eq("payroll_run_id", payrollRunId);
    }

    const { data, error: reportError } = await query;
    if (reportError) {
      setError(reportError.message);
      setRows([]);
    } else {
      setRows((data as ReportRow[]) || []);
    }
    setDataLoading(false);
  }

  function formatNumber(value: number | null | undefined, fractionDigits = 2) {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  function formatNetPay(value: number | null | undefined) {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function handleExport() {
    if (rows.length === 0) return;
    const columns: CsvColumn<ReportRow>[] = [
      { header: "Employee Code", accessor: (row) => row.employee_code ?? "" },
      { header: "Employee Name", accessor: (row) => row.employee_name ?? "" },
      { header: "Month", accessor: (row) => row.month ?? "" },
      { header: "Present Days", accessor: (row) => row.present_days ?? "" },
      { header: "Paid Leave Days", accessor: (row) => row.leave_paid_days ?? "" },
      { header: "Unpaid Leave Days", accessor: (row) => row.leave_unpaid_days ?? "" },
      { header: "Absent Days", accessor: (row) => row.absent_days ?? "" },
      { header: "Suggested Payable Days", accessor: (row) => row.payable_days_suggested ?? "" },
      {
        header: "Override Payable Days",
        accessor: (row) => (row.attendance_overridden ? row.payable_days_effective ?? "" : ""),
      },
      { header: "Final Payable Days", accessor: (row) => row.payable_days_effective ?? "" },
      { header: "Net Pay", accessor: (row) => row.net_pay ?? "" },
      { header: "Attendance Status", accessor: (row) => row.attendance_period_status ?? "" },
      { header: "Attendance Overridden", accessor: (row) => (row.attendance_overridden ? "Yes" : "No") },
      { header: "Attendance Frozen", accessor: (row) => (row.attendance_unfrozen_warning ? "No" : "Yes") },
      { header: "Payroll Finalized", accessor: (row) => (row.payroll_finalized ? "Yes" : "No") },
      { header: "Payslip Generated", accessor: (row) => (row.payslip_generated ? "Yes" : "No") },
    ];

    downloadCsv(`attendance-payroll-${monthValue}.csv`, columns, rows);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading report…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ marginTop: 0 }}>Attendance vs Payroll</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <button onClick={() => supabase.auth.signOut()} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!canView) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ marginTop: 0 }}>Attendance vs Payroll</h1>
        <p style={{ color: "#b91c1c" }}>Only HR or Admin users can access this report.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui", background: "#f8fafc", minHeight: "100vh" }}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <div style={{ padding: "24px 24px 60px", maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Attendance vs Payroll</h1>
            <p style={{ marginTop: 6, color: "#475569" }}>
              Reconcile attendance-derived suggestions with payroll overrides and final payables.
            </p>
            <p style={{ marginTop: 0, fontSize: 13, color: "#64748b" }}>
              Signed in as <strong>{ctx?.email}</strong> · Role: <strong>{ctx?.roleKey}</strong>
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← HR Home</a>
            <button type="button" onClick={handleExport} style={buttonStyle}>Export CSV</button>
          </div>
        </header>

        {error ? (
          <div style={{ marginTop: 16, padding: 12, background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 10, color: "#b91c1c" }}>
            {error}
          </div>
        ) : null}

        <section style={{ marginTop: 18, padding: 16, borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Filters</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#475569" }}>Month</span>
              <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#475569" }}>Payroll Run (optional)</span>
              <select value={payrollRunId} onChange={(e) => setPayrollRunId(e.target.value)} style={inputStyle}>
                <option value="">All runs</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.year}-{String(run.month).padStart(2, "0")} · {run.status || "status unknown"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section style={{ marginTop: 18, padding: 16, borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Reconciliation</h3>
              <p style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>
                Read-only attendance snapshot versus payroll overrides.
              </p>
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {dataLoading ? "Loading data…" : `${rows.length} records`}
            </div>
          </div>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={tableHeaderStyle}>Employee</th>
                  <th style={tableHeaderStyle}>Attendance</th>
                  <th style={tableHeaderStyle}>Suggested Payable Days</th>
                  <th style={tableHeaderStyle}>Override Payable Days</th>
                  <th style={tableHeaderStyle}>Final Payable Days</th>
                  <th style={tableHeaderStyle}>Net Pay</th>
                  <th style={tableHeaderStyle}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tableCellStyle, textAlign: "center", color: "#64748b" }}>
                      {dataLoading ? "Loading…" : "No records found for this period."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.payroll_run_id}-${row.employee_id}`}>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600 }}>{row.employee_name || "Unnamed employee"}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{row.employee_code || "No code"}</div>
                      </td>
                      <td style={tableCellStyle}>
                        <div>Present: {formatNumber(row.present_days)}</div>
                        <div>Paid Leave: {formatNumber(row.leave_paid_days)}</div>
                        <div>Unpaid Leave: {formatNumber(row.leave_unpaid_days)}</div>
                        <div>Absent: {formatNumber(row.absent_days)}</div>
                      </td>
                      <td style={tableCellStyle}>{formatNumber(row.payable_days_suggested)}</td>
                      <td style={tableCellStyle}>
                        {row.attendance_overridden ? formatNumber(row.payable_days_effective) : "-"}
                      </td>
                      <td style={tableCellStyle}>{formatNumber(row.payable_days_effective)}</td>
                      <td style={tableCellStyle}>{formatNetPay(row.net_pay)}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {row.attendance_unfrozen_warning ? (
                            <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 999, fontSize: 12, width: "fit-content" }}>
                              Attendance not frozen
                            </span>
                          ) : null}
                          {row.attendance_overridden ? (
                            <span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: 999, fontSize: 12, width: "fit-content" }}>
                              Override applied
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
