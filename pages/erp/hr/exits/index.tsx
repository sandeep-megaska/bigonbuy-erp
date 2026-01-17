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
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

type EmployeeEmbed = { id: string; full_name: string | null; employee_code: string | null };
type ExitMetaEmbed = { id: string; name: string | null };

type ExitRowBase = {
  id: string;
  status: string;
  initiated_on: string | null;
  last_working_day: string;
  notice_period_days: number | null;
  notice_waived: boolean;
  notes: string | null;
  created_at: string | null;
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

  employee: EmployeeEmbed | null;
  manager: EmployeeEmbed | null;

  exit_type: ExitMetaEmbed | null;
  exit_reason: ExitMetaEmbed | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type EmbeddedValue<T> = T | T[] | null;

function normalizeSearchTerm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeEmbed<T>(value: EmbeddedValue<T>) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function isRlsError(error: { message?: string } | null | undefined) {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("row level security") ||
    message.includes("rls") ||
    message.includes("permission denied")
  );
}

const bannerStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fffbeb",
  border: "1px solid #f59e0b",
  color: "#92400e",
  fontSize: 13,
  marginTop: 12,
};

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

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");

  const [toast, setToast] = useState<ToastState>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rlsWarning, setRlsWarning] = useState<string>("");

  const roleKey = useMemo(
    () => (access.roleKey ?? ctx?.roleKey ?? "").toString(),
    [access.roleKey, ctx?.roleKey]
  );

  const canManage = useMemo(() => access.isManager || isHr(roleKey), [access.isManager, roleKey]);
  const canComplete = useMemo(() => isHr(roleKey), [roleKey]);

  const filteredRows = useMemo(() => {
    const q = normalizeSearchTerm(employeeFilter);
    return rows.filter((row) => {
      const matchesStatus = statusFilter ? row.status === statusFilter : true;
      if (!matchesStatus) return false;
      if (!q) return true;
      const name = normalizeSearchTerm(row.employee?.full_name);
      const code = normalizeSearchTerm(row.employee?.employee_code);
      return name.includes(q) || code.includes(q);
    });
  }, [rows, employeeFilter, statusFilter]);

  const showHelperBanner = useMemo(() => {
    const hasStatus = !!normalizeSearchTerm(statusFilter);
    const hasEmployee = !!normalizeSearchTerm(employeeFilter);
    const hasActiveFilters = hasStatus || hasEmployee;
    return hasActiveFilters && !loading && filteredRows.length === 0;
  }, [statusFilter, employeeFilter, loading, filteredRows.length]);

  const showEmptyState = !loading && filteredRows.length === 0;

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

      if (!context.companyId && active) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    let active = true;
    if (!ctx) return undefined;

    (async () => {
      setLoading(true);
      await loadExits({
        statusFilter,
        searchText: employeeFilter,
      });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ctx, statusFilter]);

  async function loadExits(options: { statusFilter: string; searchText: string }) {
    const { statusFilter: statusValue, searchText } = options;
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[exits] ctx", {
        companyId: ctx?.companyId,
        userId: ctx?.userId,
        roleKey: ctx?.roleKey,
      });
      // eslint-disable-next-line no-console
      console.log("[exits] query params", {
        statusFilter: statusValue,
        searchText,
      });
    }

    try {
      let query = supabase
        .from("erp_hr_employee_exits")
        .select(
          `
          id,
          status,
          initiated_on,
          last_working_day,
          notice_period_days,
          notice_waived,
          notes,
          created_at,
          employee:erp_employees!erp_hr_employee_exits_employee_id_fkey(
            id,
            full_name,
            employee_code
          ),
          manager:erp_employees!erp_hr_employee_exits_manager_employee_id_fkey(
            id,
            full_name,
            employee_code
          ),
          exit_type:erp_hr_employee_exit_types(
            id,
            name
          ),
          exit_reason:erp_hr_employee_exit_reasons(
            id,
            name
          )
        `
        )
        .order("created_at", { ascending: false });

      if (statusValue) {
        query = query.eq("status", statusValue);
      }

      const { data, error } = await query;
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[exits] rowsError", error);
      }
      if (error) {
        if (isRlsError(error)) {
          setRlsWarning(`You don’t have access to view exits. (${error.message})`);
        }
        throw error;
      }

      setRlsWarning("");
      const raw = (data ?? []) as (ExitRowBase & {
        employee?: EmbeddedValue<EmployeeEmbed>;
        manager?: EmbeddedValue<EmployeeEmbed>;
        exit_type?: EmbeddedValue<ExitMetaEmbed>;
        exit_reason?: EmbeddedValue<ExitMetaEmbed>;
      })[];
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[exits] rows before normalize", raw.length);
      }
      const normalized: ExitRow[] = raw.map((r) => ({
        id: r.id,
        status: r.status,
        initiated_on: r.initiated_on,
        last_working_day: r.last_working_day,
        notice_period_days: r.notice_period_days,
        notice_waived: r.notice_waived,
        notes: r.notes,
        created_at: r.created_at,
        employee: normalizeEmbed(r.employee),
        manager: normalizeEmbed(r.manager),
        exit_type: normalizeEmbed(r.exit_type),
        exit_reason: normalizeEmbed(r.exit_reason),
      }));
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[exits] rows after normalize", normalized.length);
      }

      setRows(normalized);
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "Unable to load exit requests." });
      setRows([]);
    }
  }

  function clearFilters() {
    setStatusFilter("");
    setEmployeeFilter("");
    router.replace("/erp/hr/exits", undefined, { shallow: true });
  }

  async function handleComplete(exitId: string) {
    if (!canComplete) {
      setToast({ type: "error", message: "You do not have permission to complete exits." });
      return;
    }

    setActionLoading(exitId);
    const { error } = await supabase.rpc("erp_hr_exit_set_status", {
      p_exit_id: exitId,
      p_status: "completed",
      p_rejection_reason: null,
      p_payment_notes: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to complete exit request." });
      setActionLoading(null);
      return;
    }

    setToast({ type: "success", message: "Exit completed successfully." });
    setActionLoading(null);
    await loadExits({
      statusFilter,
      searchText: employeeFilter,
    });
  }

  async function handleStatusChange(exitId: string, status: "approved" | "rejected") {
    if (!canManage) {
      setToast({ type: "error", message: "You do not have permission to update exits." });
      return;
    }

    let rejectionReason = null;
    if (status === "rejected") {
      rejectionReason = window.prompt("Optional rejection reason:", "") ?? null;
      if (rejectionReason === null) return;
    }

    setActionLoading(exitId);
    const { error } = await supabase.rpc("erp_hr_exit_set_status", {
      p_exit_id: exitId,
      p_status: status,
      p_rejection_reason: rejectionReason || null,
      p_payment_notes: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to update exit request." });
      setActionLoading(null);
      return;
    }

    setToast({ type: "success", message: `Exit ${status} successfully.` });
    setActionLoading(null);
    await loadExits({
      statusFilter,
      searchText: employeeFilter,
    });
  }

  return (
    <ErpShell activeModule="hr">

      <div style={pageContainerStyle}>
        <div style={pageHeaderStyle}>
          <div>
            <div style={eyebrowStyle}>HR</div>
            <div style={h1Style}>Employee Exits</div>
            <div style={subtitleStyle}>Track resignations, terminations, and exit approvals.</div>
          </div>
        </div>

        {toast && (
          <div style={{ ...bannerStyle, background: toast.type === "error" ? "#fef2f2" : "#ecfdf5", borderColor: toast.type === "error" ? "#ef4444" : "#10b981", color: toast.type === "error" ? "#991b1b" : "#065f46" }}>
            {toast.message}
          </div>
        )}
        {rlsWarning && (
          <div style={bannerStyle}>{rlsWarning}</div>
        )}

        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "220px 1fr 160px",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <div style={{ fontSize: 12, marginBottom: 6, color: "#374151" }}>Status</div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={inputStyle}
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 12, marginBottom: 6, color: "#374151" }}>Employee search</div>
              <input
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                placeholder="Search by name or code…"
                style={inputStyle}
              />
            </div>

            <button onClick={clearFilters} style={secondaryButtonStyle}>
              Clear
            </button>
          </div>

          {showHelperBanner && (
            <div style={bannerStyle}>No exits match the current filters. Try clearing filters.</div>
          )}

          <div style={{ marginTop: 14 }}>
            {showEmptyState ? (
              <div
                style={{
                  border: "1px dashed #d1d5db",
                  borderRadius: 12,
                  padding: "18px 20px",
                  background: "#f9fafb",
                  color: "#4b5563",
                }}
              >
                <div style={{ fontWeight: 600, color: "#111827" }}>
                  {showHelperBanner ? "No exits match the current filters." : "No exit requests found."}
                </div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  {showHelperBanner
                    ? "Clear filters to see all exits."
                    : "Create a draft exit from an employee profile to get started."}
                </div>
                {!showHelperBanner ? (
                  <div style={{ marginTop: 12 }}>
                    <Link href="/erp/hr/employees" style={{ color: "#2563eb", fontWeight: 600 }}>
                      Go to employees
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Employee</th>
                      <th style={tableHeaderCellStyle}>Status</th>
                      <th style={tableHeaderCellStyle}>LWD</th>
                      <th style={tableHeaderCellStyle}>Initiated On</th>
                      <th style={tableHeaderCellStyle}>Type</th>
                      <th style={tableHeaderCellStyle}>Reason</th>
                      <th style={tableHeaderCellStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={7}>
                          Loading…
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((r) => (
                        <tr key={r.id}>
                          <td style={tableCellStyle}>
                            <div style={{ fontWeight: 600 }}>{r.employee?.full_name || "—"}</div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>{r.employee?.employee_code || ""}</div>
                          </td>
                          <td style={tableCellStyle}>
                            <span style={{ ...badgeStyle }}>{r.status}</span>
                          </td>
                          <td style={tableCellStyle}>{formatDate(r.last_working_day)}</td>
                          <td style={tableCellStyle}>{formatDate(r.initiated_on)}</td>
                          <td style={tableCellStyle}>{r.exit_type?.name || "—"}</td>
                          <td style={tableCellStyle}>{r.exit_reason?.name || "—"}</td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                              <Link href={`/erp/hr/exits/${r.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                                View
                              </Link>
                              {canManage && r.status === "draft" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(r.id, "approved")}
                                    disabled={actionLoading === r.id}
                                    style={primaryButtonStyle}
                                  >
                                    {actionLoading === r.id ? "Updating…" : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(r.id, "rejected")}
                                    disabled={actionLoading === r.id}
                                    style={secondaryButtonStyle}
                                  >
                                    {actionLoading === r.id ? "Updating…" : "Reject"}
                                  </button>
                                </>
                              ) : null}
                              {canComplete && r.status === "approved" ? (
                                <button
                                  type="button"
                                  onClick={() => handleComplete(r.id)}
                                  disabled={actionLoading === r.id}
                                  style={secondaryButtonStyle}
                                >
                                  {actionLoading === r.id ? "Completing…" : "Complete"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!canManage && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Note: Only Owner/Admin/HR can approve/complete exits.
            </div>
          )}
        </div>
      </div>
    </ErpShell>
  );
}
