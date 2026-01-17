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

function normalizeSearchTerm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function formatDate(value: string | null) {
  if (!value) return "";
  return value;
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

  const [statusFilter, setStatusFilter] = useState<string>("draft");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");

  const [toast, setToast] = useState<ToastState>(null);
  const filtersInitialized = useRef(false);

  const canManage = useMemo(() => {
    const roleKey = (access.roleKey ?? ctx?.roleKey ?? "").toString();
    return access.isManager || isHr(roleKey) || roleKey === "owner" || roleKey === "admin";
  }, [access.isManager, access.roleKey, ctx?.roleKey]);

  const filteredRows = useMemo(() => {
    const q = normalizeSearchTerm(employeeFilter);
    if (!q) return rows;
    return rows.filter((row) => {
      const name = normalizeSearchTerm(row.employee?.full_name);
      const code = normalizeSearchTerm(row.employee?.employee_code);
      return name.includes(q) || code.includes(q);
    });
  }, [rows, employeeFilter]);

  const showHelperBanner = useMemo(() => {
    const hasStatus = !!normalizeSearchTerm(statusFilter);
    const hasEmployee = !!normalizeSearchTerm(employeeFilter);
    const hasActiveFilters = hasStatus || hasEmployee;
    return hasActiveFilters && !loading && filteredRows.length === 0;
  }, [statusFilter, employeeFilter, loading, filteredRows.length]);

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

      await loadExits(context.companyId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!router.isReady || filtersInitialized.current) return;

    const hasStatus = Object.prototype.hasOwnProperty.call(router.query, "status");
    const hasEmployee = Object.prototype.hasOwnProperty.call(router.query, "employee");

    const statusParam = typeof router.query.status === "string" ? router.query.status : "";
    const employeeParam = typeof router.query.employee === "string" ? router.query.employee : "";

    setStatusFilter(hasStatus ? statusParam : "draft");
    setEmployeeFilter(hasEmployee ? employeeParam : "");

    filtersInitialized.current = true;
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadExits(ctx.companyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.companyId, statusFilter]);

  async function loadExits(companyId: string) {
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
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const raw = (data ?? []) as ExitRowRaw[];
      const normalized: ExitRow[] = raw.map((r) => ({
        id: r.id,
        status: r.status,
        initiated_on: r.initiated_on,
        last_working_day: r.last_working_day,
        notice_period_days: r.notice_period_days,
        notice_waived: r.notice_waived,
        notes: r.notes,
        created_at: r.created_at,

        employee: r.employee?.[0] ?? null,
        manager: r.manager?.[0] ?? null,

        exit_type: r.exit_type?.[0] ?? null,
        exit_reason: r.exit_reason?.[0] ?? null,
      }));

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

        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 160px", gap: 12, alignItems: "end" }}>
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

          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Employee</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>LWD</th>
                  <th style={tableHeaderCellStyle}>Initiated</th>
                  <th style={tableHeaderCellStyle}>Type</th>
                  <th style={tableHeaderCellStyle}>Reason</th>
                  <th style={tableHeaderCellStyle}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      No exit requests found.
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
                        <Link href={`/erp/hr/exits/${r.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
