import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";

import ErpShell from "../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";

import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "withdrawn", label: "Withdrawn" },
];

const STATUS_STYLES: Record<string, CSSProperties> = {
  draft: { backgroundColor: "#e0f2fe", color: "#0369a1" },
  submitted: { backgroundColor: "#fef3c7", color: "#92400e" },
  approved: { backgroundColor: "#dcfce7", color: "#166534" },
  rejected: { backgroundColor: "#fee2e2", color: "#b91c1c" },
  completed: { backgroundColor: "#e5e7eb", color: "#1f2937" },
  withdrawn: { backgroundColor: "#f3f4f6", color: "#374151" },
};

const bannerStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  fontSize: 13,
};

type ExitRow = {
  id: string;
  employee_id: string;
  status: string;
  last_working_day: string;
  created_at: string | null;
};

type EmployeeRow = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export default function HrExitIndexPage() {
  const router = useRouter();

  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExitRow[]>([]);
  const [employeeMap, setEmployeeMap] = useState<Record<string, EmployeeRow>>({});
  const [statusFilter, setStatusFilter] = useState<string>("draft");
  const [search, setSearch] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [queryError, setQueryError] = useState<string | null>(null);
  const [rawRowCount, setRawRowCount] = useState(0);

  const filteredRows = useMemo(() => {
    const term = normalizeTerm(search);
    if (!term) return rows;
    return rows.filter((row) => {
      const employee = employeeMap[row.employee_id];
      const values = [employee?.full_name, employee?.employee_code]
        .filter(Boolean)
        .join(" ");
      return normalizeTerm(values).includes(term);
    });
  }, [rows, employeeMap, search]);

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
    let active = true;
    if (!ctx?.companyId) return undefined;

    (async () => {
      setLoading(true);
      await loadExits(ctx.companyId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, statusFilter]);

  async function loadExits(companyId: string) {
    setError("");
    setQueryError(null);
    const baseQuery = supabase
      .from("erp_hr_employee_exits")
      .select("id, employee_id, status, last_working_day, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    const { data, error: exitError } =
      statusFilter === "all" ? await baseQuery : await baseQuery.eq("status", statusFilter);

    setQueryError(exitError?.message ?? null);

    if (exitError) {
      setRows([]);
      setEmployeeMap({});
      setRawRowCount(0);
      setError(exitError.message || "Unable to load exit requests.");
      return;
    }

    const exitRows = data ?? [];
    setRows(exitRows);
    setRawRowCount(exitRows.length);

    const employeeIds = Array.from(
      new Set(exitRows.map((row) => row.employee_id).filter(Boolean))
    );

    if (!employeeIds.length) {
      setEmployeeMap({});
      return;
    }

    const { data: employees, error: employeeError } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .in("id", employeeIds);

    if (employeeError) {
      setEmployeeMap({});
      setError((prev) => prev || employeeError.message || "Unable to load employees.");
      return;
    }

    const map = (employees || []).reduce<Record<string, EmployeeRow>>((acc, employee) => {
      acc[employee.id] = employee;
      return acc;
    }, {});
    setEmployeeMap(map);
  }

  const showEmptyState = !loading && filteredRows.length === 0;
  const showDebug = process.env.NODE_ENV !== "production" && rawRowCount === 0;

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR</p>
            <h1 style={h1Style}>Employee Exits</h1>
            <p style={subtitleStyle}>Track exit requests and their current status.</p>
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>Total exits: {rows.length}</div>
            {filteredRows.length !== rows.length ? (
              <div style={{ color: "#6b7280", fontSize: 13 }}>
                Showing {filteredRows.length}
              </div>
            ) : null}
          </div>
        </header>

        {error ? <div style={bannerStyle}>{error}</div> : null}

        <section style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Status</span>
            <select
              style={{ ...inputStyle, minWidth: 180 }}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>
              Search employee
            </span>
            <input
              style={{ ...inputStyle, minWidth: 220 }}
              placeholder="Search by name or code"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </section>

        {loading ? (
          <div style={cardStyle}>Loading exits…</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Employee</th>
                <th style={tableHeaderCellStyle}>Last Working Day</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const employee = employeeMap[row.employee_id];
                return (
                  <tr key={row.id}>
                    <td style={tableCellStyle}>{formatDate(row.created_at)}</td>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{employee?.full_name || "Employee"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>
                        {employee?.employee_code || row.employee_id}
                      </div>
                    </td>
                    <td style={tableCellStyle}>{formatDate(row.last_working_day)}</td>
                    <td style={tableCellStyle}>
                      <span
                        style={{
                          ...badgeStyle,
                          ...(STATUS_STYLES[row.status?.toLowerCase()] || STATUS_STYLES.draft),
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/hr/exits/${row.id}`} style={secondaryButtonStyle}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {showEmptyState ? (
          <div style={cardStyle}>
            {rows.length === 0
              ? "No exit requests have been created yet."
              : "No exit requests match the current filters."}
          </div>
        ) : null}

        {showDebug ? (
          <details style={{ ...cardStyle, fontSize: 12, maxWidth: 420 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Debug</summary>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              <div>
                <strong>companyId:</strong> {ctx?.companyId || "—"}
              </div>
              <div>
                <strong>filters:</strong> {JSON.stringify({ statusFilter, search })}
              </div>
              <div>
                <strong>supabase error:</strong> {queryError || "none"}
              </div>
              <div>
                <strong>raw row count:</strong> {rawRowCount}
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </ErpShell>
  );
}
