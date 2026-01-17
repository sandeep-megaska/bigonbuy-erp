import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
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

function getCurrentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeSearchTerm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isAllMonths(value: string) {
  const normalized = normalizeSearchTerm(value);
  return !normalized || normalized === "all" || normalized === "all months" || normalized === "all_months";
}

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
  const [statusFilter, setStatusFilter] = useState("draft");
  const [monthFilter, setMonthFilter] = useState(() => getCurrentMonthString());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [rejectModal, setRejectModal] = useState<{ exitId: string; reason: string } | null>(null);
  const filtersInitialized = useRef(false);

  const canManage = useMemo(() => {
    const roleKey = (access.roleKey ?? ctx?.roleKey ?? "").toString();
    return access.isManager || isHr(roleKey) || roleKey === "owner" || roleKey === "admin";
  }, [access.isManager, access.roleKey, ctx?.roleKey]);

  const filteredRows = useMemo(() => {
    const query = normalizeSearchTerm(employeeFilter);
    if (!query) return rows;
    return rows.filter((row) => {
      const name = normalizeSearchTerm(row.employee?.full_name);
      const code = normalizeSearchTerm(row.employee?.employee_code);
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
    if (!router.isReady || filtersInitialized.current) return;
    const hasStatus = Object.prototype.hasOwnProperty.call(router.query, "status");
    const hasMonth = Object.prototype.hasOwnProperty.call(router.query, "month");
    const hasEmployee = Object.prototype.hasOwnProperty.call(router.query, "employee");

    const statusParam = typeof router.query.status === "string" ? router.query.status : "";
    const monthParam = typeof router.query.month === "string" ? router.query.month : "";
    const employeeParam = typeof router.query.employee === "string" ? router.query.employee : "";

    setStatusFilter(hasStatus ? statusParam : "draft");
    setMonthFilter(hasMonth ? monthParam : getCurrentMonthString());
    setEmployeeFilter(hasEmployee ? employeeParam : "");
    filtersInitialized.current = true;
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadExits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, monthFilter]);
  async function loadExits() {
  try {
    let query = supabase
      .from("erp_hr_employee_exits")
      .select(`
        id,
        status,
        initiated_on,
        last_working_day,
        notice_period_days,
        notice_waived,
        notes,
        created_at,

        employee:erp_employees!erp_hr_employee_exits_employee_id_fkey (
          id, full_name, employee_code
        ),

        manager:erp_employees!erp_hr_employee_exits_manager_employee_id_fkey (
          id, full_name, employee_code
        ),

        exit_type:erp_hr_employee_exit_types ( id, name ),
        exit_reason:erp_hr_employee_exit_reasons ( id, name )
      `)
      .eq("company_id", ctx.companyId)          // ✅ REQUIRED
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    if (!isAllMonths(monthFilter)) {
      const startDate = `${monthFilter}-01`;
      const [year, month] = monthFilter.split("-").map(Number);
      const nextMonth =
        month === 12
          ? `${year + 1}-01`
          : `${year}-${String(month + 1).padStart(2, "0")}`;

      query = query
        .gte("last_working_day", startDate)
        .lt("last_working_day", `${nextMonth}-01`);
    }

    const { data, error } = await query;

    if (error) throw error;


    const raw = (data ?? []) as any[];

    const normalized: ExitRow[] = raw.map((r) => ({
  ...r,
  // handle both shapes: array or object
  employee: Array.isArray(r.employee) ? (r.employee[0] ?? null) : (r.employee ?? null),
  manager: Array.isArray(r.manager) ? (r.manager[0] ?? null) : (r.manager ?? null),
  exit_type: Array.isArray(r.exit_type) ? (r.exit_type[0] ?? null) : (r.exit_type ?? null),
  exit_reason: Array.isArray(r.exit_reason) ? (r.exit_reason[0] ?? null) : (r.exit_reason ?? null),
}));

    setRows(normalized);

  } catch (e: any) {
    setToast({
      type: "error",
      message: e.message || "Unable to load exit requests",
    });
  }
}

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleAction(action: "approve" | "reject" | "complete", exitId: string) {
    if (!canManage) {
      showToast("You do not have permission to update exit requests.", "error");
      return;
    }

    if (action === "reject") {
      setRejectModal({ exitId, reason: "" });
      return;
    }

    await submitStatusChange(exitId, action);
  }

  async function submitStatusChange(
    exitId: string,
    status: "approve" | "reject" | "complete" | "approved" | "rejected" | "completed",
    reason?: string
  ) {
    const normalized =
      status === "approve" ? "approved" : status === "reject" ? "rejected" : status === "complete" ? "completed" : status;
    setActionLoading(exitId);
    const { error } = await supabase.rpc("erp_hr_exit_set_status", {
      p_exit_id: exitId,
      p_status: normalized,
      p_rejection_reason: reason ?? null,
    });

    if (error) {
      showToast(error.message || "Unable to update exit request.", "error");
      setActionLoading(null);
      return;
    }

    showToast(`Exit request ${normalized} successfully.`);
    await loadExits();
    setActionLoading(null);
  }

  function renderStatusBadge(status: string) {
    const normalized = status?.toLowerCase() || "draft";
    const colors: Record<string, CSSProperties> = {
      draft: { backgroundColor: "#e0f2fe", color: "#0369a1" },
      approved: { backgroundColor: "#dcfce7", color: "#166534" },
      rejected: { backgroundColor: "#fee2e2", color: "#b91c1c" },
      completed: { backgroundColor: "#e5e7eb", color: "#1f2937" },
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
        {rejectModal ? (
          <div style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <h3 style={{ marginTop: 0 }}>Reject Exit Request</h3>
              <p style={{ color: "#6b7280", marginTop: 4 }}>
                Add an optional rejection reason to share with HR and the manager.
              </p>
              <textarea
                value={rejectModal.reason}
                onChange={(event) =>
                  setRejectModal((prev) => (prev ? { ...prev, reason: event.target.value } : prev))
                }
                rows={4}
                style={{ ...inputStyle, width: "100%", resize: "vertical" }}
                placeholder="Optional rejection reason"
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setRejectModal(null)}
                  disabled={actionLoading === rejectModal.exitId}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={actionLoading === rejectModal.exitId}
                  onClick={async () => {
                    const payload = rejectModal;
                    setRejectModal(null);
                    await submitStatusChange(payload.exitId, "rejected", payload.reason);
                  }}
                >
                  {actionLoading === rejectModal.exitId ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </div>
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
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="month"
                  value={monthFilter}
                  onChange={(event) => setMonthFilter(event.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={!monthFilter}
                  onClick={() => setMonthFilter("")}
                >
                  All months
                </button>
              </div>
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
                  setStatusFilter("draft");
                  setMonthFilter(getCurrentMonthString());
                  setEmployeeFilter("");
                }}
              >
                Reset filters
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          {!filteredRows.length && (statusFilter || monthFilter || employeeFilter) ? (
            <div
              style={{
                ...cardStyle,
                marginBottom: 16,
                borderColor: "#bae6fd",
                backgroundColor: "#eff6ff",
                color: "#1e3a8a",
              }}
            >
              No exits match the current filters. Try clearing filters.
            </div>
          ) : null}
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
                            View / Manage
                          </Link>
                          {row.status === "draft" ? (
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

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
  display: "grid",
  gap: 12,
};
