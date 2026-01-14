import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getEmployeeContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half Day",
  leave: "Leave",
  holiday: "Holiday",
  weekoff: "Week Off",
};

type AttendanceRow = {
  id: string;
  att_date: string;
  status: string;
  in_time: string | null;
  out_time: string | null;
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
      .from("erp_attendance_days")
      .select("id, att_date, status, in_time, out_time, notes")
      .eq("employee_id", employeeId)
      .gte("att_date", range.start)
      .lte("att_date", range.end)
      .order("att_date", { ascending: false });

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
    return <div style={containerStyle}>Loading attendance…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>My Attendance</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No employee profile is linked to this account."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={access.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Employee · Attendance</p>
          <h1 style={titleStyle}>My Attendance</h1>
          <p style={subtitleStyle}>Review your attendance records by month.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp" style={linkStyle}>← Back to ERP Home</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

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
                    <td style={tdStyle}>{formatDate(row.att_date)}</td>
                    <td style={tdStyle}>{STATUS_LABELS[row.status] || row.status}</td>
                    <td style={tdStyle}>{row.in_time || "—"}</td>
                    <td style={tdStyle}>{row.out_time || "—"}</td>
                    <td style={tdStyle}>{row.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-start",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 20,
  marginBottom: 20,
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "6px 0 8px", fontSize: 30, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

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

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
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
