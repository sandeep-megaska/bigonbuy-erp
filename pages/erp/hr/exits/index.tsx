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
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "withdrawn", label: "Withdrawn" },
];
type ExitRowRaw = {
  id: string;
  status: string;
  initiated_on: string | null;
  last_working_day: string;
  notice_period_days: number | null;
  notice_waived: boolean;
  notes: string | null;
  created_at: string | null;

  employee: { id: string; full_name: string | null; employee_code: string | null }[] | null;
  manager: { id: string; full_name: string | null; employee_code: string | null }[] | null;

  exit_type: { id: string; name: string | null }[] | null;
  exit_reason: { id: string; name: string | null }[] | null;
};
type ExitRow = {
  id: string;
  status: string;
  initiated_on: string | null;
  last_working_day: string;
  notice_period_days: number | null;
  notice_waived: boolean;
  notes: string | null;
  created_at: string | null;

  employee: { id: string; full_name: string | null; employee_code: string | null } | null;
  manager: { id: string; full_name: string | null; employee_code: string | null } | null;

  exit_type: { id: string; name: string | null } | null;
  exit_reason: { id: string; name: string | null } | null;
};


type ToastState = { type: "success" | "error"; message: string } | null;

export default function EmployeeExitsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExitRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const filteredRows = useMemo(() => {
    const query = employeeFilter.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const name = row.employee?.full_name?.toLowerCase() || "";
      const code = row.employee?.employee_code?.toLowerCase() || "";
      return name.includes(query) || code.includes(query);
    });
  }, [rows, employeeFilter]);

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

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

      await loadExits();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadExits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, monthFilter]);
async function loadExits() {
  try {
    let query = supabase
      .from("erp_hr_employee_exits")
      .select(
        `
        id, status, initiated_on, last_working_day,
        notice_period_days, notice_waived, notes, created_at,

        employee:erp_employees!erp_hr_employee_exits_employee_id_fkey (
          id, full_name, employee_code
        ),

        manager:erp_employees!erp_hr_employee_exits_manager_employee_id_fkey (
          id, full_name, employee_code
        ),

        exit_type:erp_hr_employee_exit_types ( id, name ),
        exit_reason:erp_hr_employee_exit_reasons ( id, name )
      `
      )
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    if (monthFilter) {
      const startDate = `${monthFilter}-01`;
      const [year, month] = monthFilter.split("-").map((n) => Number(n));
      const nextMonth =
        month === 12
          ? `${year + 1}-01`
          : `${year}-${String(month + 1).padStart(2, "0")}`;

      query = query
        .gte("last_working_day", startDate)
        .lt("last_working_day", `${nextMonth}-01`);
    }

    const { data: rowsData, error: rowsError } = await query;

    if (rowsError) {
      setToast({
        type: "error",
        message: rowsError.message || "Unable to load exit requests.",
      });
      return;
    }

    // With explicit FK embeds (!..._fkey), employee/manager/exit_type/exit_reason come back as objects (or null).
  const raw = (rowsData ?? []) as ExitRowRaw[];

const normalized: ExitRow[] = raw.map((r) => ({
  id: r.id,
  status: r.status,
  initiated_on: r.initiated_on,
  last_working_day: r.last_working_day,
  notice_period_days: r.notice_period_days,
  notice_waived: r.notice_waived,
  notes: r.notes,
  created_at: r.created_at ?? null,

  employee: r.employee?.[0] ?? null,
  manager: r.manager?.[0] ?? null,
  exit_type: r.exit_type?.[0] ?? null,
  exit_reason: r.exit_reason?.[0] ?? null,
}));

setRows(normalized);

  } catch (e: any) {
    setToast({
      type: "error",
      message: e?.message || "Unable to load exit requests.",
    });
  }
}

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleAction(action: "submit" | "approve" | "reject" | "complete", exitId: string) {
    if (!canManage) {
      showToast("You do not have permission to update exit requests.", "error");
      return;
    }

    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Rejection reason (optional)") || "";
    }

    setActionLoading(exitId);
    const rpcName =
      action === "submit"
        ? "erp_hr_employee_exit_submit"
        : action === "approve"
          ? "erp_hr_employee_exit_approve"
          : action === "reject"
            ? "erp_hr_employee_exit_reject"
            : "erp_hr_employee_exit_complete";
    const payload = action === "reject" ? { p_exit_id: exitId, p_reason: reason } : { p_exit_id: exitId };
    const { error } = await supabase.rpc(rpcName, payload);

    if (error) {
      showToast(error.message || "Unable to update exit request.", "error");
      setActionLoading(null);
      return;
    }

    showToast(`Exit request ${action}d successfully.`);
    await loadExits();
    setActionLoading(null);
  }

  function renderStatusBadge(status: string) {
    const normalized = status?.toLowerCase() || "draft";
    const colors: Record<string, CSSProperties> = {
      draft: { backgroundColor: "#e0f2fe", color: "#0369a1" },
      submitted: { backgroundColor: "#fef3c7", color: "#b45309" },
      approved: { backgroundColor: "#dcfce7", color: "#166534" },
      rejected: { backgroundColor: "#fee2e2", color: "#b91c1c" },
      completed: { backgroundColor: "#e5e7eb", color: "#1f2937" },
      withdrawn: { backgroundColor: "#e5e7eb", color: "#1f2937" },
    };
    return (
      <span style={{ ...badgeStyle, ...colors[normalized] }}>{status}</span>
    );
  }

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading employee exits…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Employee Exits</h1>
          <p style={{ color: "#b91c1c" }}>No active company membership found.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR · Operations</p>
            <h1 style={h1Style}>Employee Exits</h1>
            <p style={subtitleStyle}>
              Manage separations with manager approvals and final completion.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>
              HR Home
            </Link>
            <Link href="/erp/hr/employees" style={{ color: "#2563eb", textDecoration: "none" }}>
              Employees
            </Link>
          </div>
        </header>

        {toast ? (
          <div
            style={{
              ...cardStyle,
              borderColor: toast.type === "success" ? "#86efac" : "#fecaca",
              backgroundColor: toast.type === "success" ? "#ecfdf3" : "#fff1f2",
              color: toast.type === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {toast.message}
          </div>
        ) : null}

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <label style={labelStyle}>
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={inputStyle}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Last working month
              <input
                type="month"
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Employee search
              <input
                type="text"
                placeholder="Name or code"
                value={employeeFilter}
                onChange={(event) => setEmployeeFilter(event.target.value)}
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  setStatusFilter("");
                  setMonthFilter("");
                  setEmployeeFilter("");
                }}
              >
                Reset filters
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          {!filteredRows.length ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No exit requests found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Employee</th>
                    <th style={tableHeaderCellStyle}>Exit Type</th>
                    <th style={tableHeaderCellStyle}>Reason</th>
                    <th style={tableHeaderCellStyle}>Last Working Day</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600 }}>{row.employee?.full_name || "Unnamed"}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>
                          {row.employee?.employee_code || "—"}
                        </div>
                      </td>
                      <td style={tableCellStyle}>{row.exit_type?.name || "—"}</td>
                      <td style={tableCellStyle}>{row.exit_reason?.name || "—"}</td>
                      <td style={tableCellStyle}>{row.last_working_day}</td>
                      <td style={tableCellStyle}>{renderStatusBadge(row.status)}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Link
                            href={`/erp/hr/exits/${row.id}`}
                            style={{ ...secondaryButtonStyle, textDecoration: "none", display: "inline-flex" }}
                          >
                            View
                          </Link>
                          {row.status === "draft" ? (
                            <button
                              type="button"
                              style={primaryButtonStyle}
                              disabled={actionLoading === row.id || !canManage}
                              onClick={() => handleAction("submit", row.id)}
                            >
                              {actionLoading === row.id ? "Submitting…" : "Submit"}
                            </button>
                          ) : null}
                          {row.status === "submitted" ? (
                            <>
                              <button
                                type="button"
                                style={primaryButtonStyle}
                                disabled={actionLoading === row.id || !canManage}
                                onClick={() => handleAction("approve", row.id)}
                              >
                                {actionLoading === row.id ? "Approving…" : "Approve"}
                              </button>
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                disabled={actionLoading === row.id || !canManage}
                                onClick={() => handleAction("reject", row.id)}
                              >
                                {actionLoading === row.id ? "Rejecting…" : "Reject"}
                              </button>
                            </>
                          ) : null}
                          {row.status === "approved" ? (
                            <button
                              type="button"
                              style={primaryButtonStyle}
                              disabled={actionLoading === row.id || !canManage}
                              onClick={() => handleAction("complete", row.id)}
                            >
                              {actionLoading === row.id ? "Completing…" : "Complete"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpShell>
  );
}

const filterGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#111827",
  fontWeight: 600,
};
