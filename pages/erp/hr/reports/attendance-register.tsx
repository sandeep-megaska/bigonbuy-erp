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
  getAttendanceRegister,
  type AttendanceRegisterRow,
} from "../../../../lib/erp/reports";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

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

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

type EmployeeMeta = {
  id: string;
  designation: string | null;
};

export default function AttendanceRegisterReportPage() {
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
  const [rows, setRows] = useState<AttendanceRegisterRow[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [employeeMeta, setEmployeeMeta] = useState<Record<string, EmployeeMeta>>({});

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
    loadEmployeeMeta();
  }, [ctx?.companyId, canView]);

  useEffect(() => {
    if (!ctx?.companyId || !canView) return;
    loadReport();
  }, [ctx?.companyId, canView, start, end]);

  async function loadEmployeeMeta() {
    const { data, error: metaError } = await supabase
      .from("erp_employees")
      .select("id, designation")
      .order("full_name", { ascending: true });

    if (metaError) {
      setError(metaError.message);
      return;
    }

    const meta = ((data as EmployeeMeta[]) || []).reduce<Record<string, EmployeeMeta>>(
      (acc, row) => {
        acc[row.id] = row;
        return acc;
      },
      {}
    );

    setEmployeeMeta(meta);
  }

  async function loadReport() {
    setDataLoading(true);
    setError("");

    try {
      const data = await getAttendanceRegister({ start, end });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report.");
      setRows([]);
    } finally {
      setDataLoading(false);
    }
  }

  const designationOptions = useMemo(() => {
    const names = Object.values(employeeMeta)
      .map((row) => row.designation)
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(names)).sort();
  }, [employeeMeta]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const name = row.employee_name?.toLowerCase() ?? "";
      const code = row.employee_code?.toLowerCase() ?? "";
      const employeeMatch = employeeFilter
        ? name.includes(employeeFilter.toLowerCase()) || code.includes(employeeFilter.toLowerCase())
        : true;
      const designation = employeeMeta[row.employee_id]?.designation?.toLowerCase() ?? "";
      const designationMatch = designationFilter
        ? designation === designationFilter.toLowerCase()
        : true;
      return employeeMatch && designationMatch;
    });
  }, [rows, employeeFilter, designationFilter, employeeMeta]);

  function handleExport() {
    if (filteredRows.length === 0) return;
    const columns: CsvColumn<AttendanceRegisterRow>[] = [
      { header: "Work Date", accessor: (row) => row.work_date },
      { header: "Employee Code", accessor: (row) => row.employee_code ?? "" },
      { header: "Employee Name", accessor: (row) => row.employee_name ?? "" },
      { header: "Shift", accessor: (row) => row.shift_name ?? "" },
      { header: "Status", accessor: (row) => row.status ?? "" },
      { header: "Remarks", accessor: (row) => row.remarks ?? "" },
    ];
    const filename = `attendance-register-${start}-to-${end}.csv`;
    downloadCsv(filename, columns, filteredRows);
  }

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading attendance register…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Attendance Register</h1>
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
            <h1 style={h1Style}>Attendance Register</h1>
            <p style={subtitleStyle}>
              Print-friendly daily register of attendance statuses and remarks.
            </p>
          </div>
        </header>
        <ReportBrandHeader />

      <section style={cardStyle} className="no-print">
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
            <label style={labelStyle}>Filter by employee</label>
            <input
              type="text"
              placeholder="Name or code"
              value={employeeFilter}
              style={inputStyle}
              onChange={(event) => setEmployeeFilter(event.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Filter by designation (optional)</label>
            <select
              value={designationFilter}
              style={inputStyle}
              onChange={(event) => setDesignationFilter(event.target.value)}
            >
              <option value="">All designations</option>
              {designationOptions.map((designation) => (
                <option key={designation} value={designation}>
                  {designation}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={handleExport}
              disabled={!filteredRows.length}
            >
              Export CSV
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {dataLoading ? <p>Loading report…</p> : null}
        {!dataLoading && filteredRows.length === 0 ? <p>No attendance records for the selected period.</p> : null}

        {filteredRows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Work Date</th>
                  <th style={tableHeaderStyle}>Employee</th>
                  <th style={tableHeaderStyle}>Shift</th>
                  <th style={tableHeaderStyle}>Status</th>
                  <th style={tableHeaderStyle}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={`${row.employee_id}-${row.work_date}-${index}`}>
                    <td style={tableCellStyle}>{row.work_date}</td>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{row.employee_name ?? "Unnamed"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{row.employee_code ?? "-"}</div>
                    </td>
                    <td style={tableCellStyle}>{row.shift_name ?? "-"}</td>
                    <td style={tableCellStyle}>{row.status ?? "-"}</td>
                    <td style={tableCellStyle}>{row.remarks ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <style jsx global>{`
        @media print {
          body {
            background: #fff;
          }
          .no-print,
          nav {
            display: none !important;
          }
          table {
            font-size: 12px;
          }
        }
      `}</style>
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
