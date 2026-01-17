import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

type ExitRow = {
  id: string;
  status: string;
  initiated_on: string;
  last_working_day: string;
  notice_period_days: number | null;
  notice_waived: boolean;
  notes: string | null;
  created_at: string;

  employee: {
    id: string;
    full_name: string | null;
    employee_code: string | null;
  } | null;

  manager: {
    id: string;
    full_name: string | null;
    employee_code: string | null;
  } | null;

  exit_type: { id: string; name: string | null } | null;
  exit_reason: { id: string; name: string | null } | null;
};

export default function EmployeeExitsPage() {
  const router = useRouter();
  const { ctx, loading: ctxLoading } = getCompanyContext();

  const [rows, setRows] = useState<ExitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    requireAuthRedirectHome(router);
  }, [router]);

  useEffect(() => {
    if (ctxLoading) return;
    if (!ctx?.companyId) return;
    loadExits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.companyId, statusFilter]);

  async function loadExits() {
    if (!ctx?.companyId) return;

    setLoading(true);
    setToast(null);

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
        .eq("company_id", ctx.companyId)
        .order("created_at", { ascending: false });

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const raw = (data ?? []) as any[];

      const normalized: ExitRow[] = raw.map((r) => ({
        ...r,
        employee: Array.isArray(r.employee) ? r.employee[0] ?? null : r.employee ?? null,
        manager: Array.isArray(r.manager) ? r.manager[0] ?? null : r.manager ?? null,
        exit_type: Array.isArray(r.exit_type) ? r.exit_type[0] ?? null : r.exit_type ?? null,
        exit_reason: Array.isArray(r.exit_reason) ? r.exit_reason[0] ?? null : r.exit_reason ?? null,
      }));

      setRows(normalized);
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "Unable to load employee exits." });
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!employeeSearch.trim()) return rows;
    const q = employeeSearch.toLowerCase();
    return rows.filter(
      (r) =>
        r.employee?.full_name?.toLowerCase().includes(q) ||
        r.employee?.employee_code?.toLowerCase().includes(q)
    );
  }, [rows, employeeSearch]);

  return (
    <div className="erp-page">
      <div className="erp-page-header">
        <h1>Employee Exits</h1>
        <p>Manage separations with manager approvals and final completion.</p>
        <div className="erp-page-links">
          <Link href="/erp/hr">HR Home</Link> · <Link href="/erp/hr/employees">Employees</Link>
        </div>
      </div>

      {toast && <div className={`erp-toast ${toast.type}`}>{toast.message}</div>}

      <div className="erp-card">
        <div className="erp-filters">
          <div>
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div>
            <label>Employee search</label>
            <input
              placeholder="Name or code"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
            />
          </div>

          <button
            className="btn-outline"
            onClick={() => {
              setStatusFilter("all");
              setEmployeeSearch("");
              router.replace("/erp/hr/exits", undefined, { shallow: true });
            }}
          >
            Reset filters
          </button>
        </div>
      </div>

      <div className="erp-card">
        {loading && <p>Loading exits…</p>}

        {!loading && filteredRows.length === 0 && <div className="erp-empty">No exit requests found.</div>}

        {!loading && filteredRows.length > 0 && (
          <table className="erp-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Exit Type</th>
                <th>Last Working Day</th>
                <th>Initiated On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.employee?.full_name}
                    <div className="muted">{r.employee?.employee_code}</div>
                  </td>
                  <td>{r.status}</td>
                  <td>{r.exit_type?.name ?? "-"}</td>
                  <td>{r.last_working_day}</td>
                  <td>{r.initiated_on}</td>
                  <td>
                    <Link href={`/erp/hr/exits/${r.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
