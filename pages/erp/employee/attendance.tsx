import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../components/erp/uiStyles";
import { getEmployeeContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  holiday: "Holiday",
  weekly_off: "Week Off",
  half_day: "Half Day",
  weekoff: "Week Off",
};

type AttendanceRow = {
  id: string;
  day: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function EmployeeAttendancePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [toast, setToast] = useState<ToastState>(null);

  const monthRange = useMemo(() => {
    if (!monthValue) return null;
    const [year, month] = monthValue.split("-").map(Number);
    if (!year || !month) return null;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }, [monthValue]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getEmployeeContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId || !context.employeeId) {
        setLoading(false);
        return;
      }

      await loadAttendance(context.employeeId, monthRange);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.employeeId || !monthRange) return;
    loadAttendance(ctx.employeeId, monthRange);
  }, [ctx?.employeeId, monthRange]);

  async function loadAttendance(employeeId: string, range: { start: string; end: string } | null) {
    if (!range) return;
    const { data, error } = await supabase
      .from("erp_hr_attendance_days")
      .select("id, day, status, check_in_at, check_out_at, notes")
      .eq("employee_id", employeeId)
      .gte("day", range.start)
      .lte("day", range.end)
      .order("day", { ascending: false });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setAttendance((data as AttendanceRow[]) || []);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return (
      <ErpShell activeModule="employee">
        <div style={pageContainerStyle}>Loading attendance…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <ErpShell activeModule="employee">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Employee"
            title="My Attendance"
            description="Review your attendance records by month."
            rightActions={
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            }
          />
          <p style={{ color: "#b91c1c" }}>
            {ctx?.membershipError || "No employee profile is linked to this account."}
          </p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="employee">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Employee"
          title="My Attendance"
          description="Review your attendance records by month."
          rightActions={
            <>
              <Link href="/erp" style={linkButtonStyle}>
                Back to ERP Home
              </Link>
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            </>
          }
        />

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={toolbarStyle}>
          <label style={filterLabelStyle}>
            Month
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              style={inputStyle}
            />
          </label>
          <span style={{ color: "#6b7280" }}>Records: {attendance.length}</span>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>In</th>
                <th style={thStyle}>Out</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attendance.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: "center" }}>
                    No attendance records found.
                  </td>
                </tr>
              ) : (
                attendance.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{formatDate(row.day)}</td>
                    <td style={tdStyle}>{STATUS_LABELS[row.status] || row.status}</td>
                    <td style={tdStyle}>{formatTime(row.check_in_at)}</td>
                    <td style={tdStyle}>{formatTime(row.check_out_at)}</td>
                    <td style={tdStyle}>{row.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </ErpShell>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const linkButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 18 };

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const filterLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  color: "#111827",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  minWidth: 160,
};

const tableWrapStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflowX: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  backgroundColor: "#f9fafb",
  color: "#374151",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderTop: "1px solid #e5e7eb",
  verticalAlign: "top",
};

const errorBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  marginBottom: 16,
};

const successBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  backgroundColor: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#047857",
  marginBottom: 16,
};
