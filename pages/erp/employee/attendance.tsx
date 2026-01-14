import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const pageWrapper: React.CSSProperties = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1200,
  margin: "0 auto",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
};

const toastStyle = (type: "success" | "error"): React.CSSProperties => ({
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${type === "success" ? "#a7f3d0" : "#fecaca"}`,
  background: type === "success" ? "#ecfdf5" : "#fef2f2",
  color: type === "success" ? "#047857" : "#b91c1c",
  marginBottom: 12,
});

const listTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
};

const badgeStyle = (status: string): React.CSSProperties => {
  const palette: Record<string, { bg: string; border: string; color: string }> = {
    present: { bg: "#ecfdf3", border: "#a7f3d0", color: "#047857" },
    absent: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
    half_day: { bg: "#fef9c3", border: "#fde68a", color: "#92400e" },
    leave: { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
    holiday: { bg: "#f3f4f6", border: "#e5e7eb", color: "#374151" },
    weekoff: { bg: "#f3f4f6", border: "#e5e7eb", color: "#374151" },
  };
  const colors = palette[status] ?? palette.present;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    background: colors.bg,
    color: colors.color,
    border: `1px solid ${colors.border}`,
    fontSize: 12,
    textTransform: "capitalize",
  };
};

type AttendanceDay = {
  id: string;
  att_date: string;
  status: string;
  in_time: string | null;
  out_time: string | null;
  notes: string | null;
};

function getMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDaysRange(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export default function EmployeeAttendancePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined as string | undefined });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [attendance, setAttendance] = useState<AttendanceDay[]>([]);
  const [month, setMonth] = useState(getMonthValue(new Date()));

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
      setAccess(accessState);
      setCtx(context);
      if (!context.companyId) {
        setToast({ type: "error", message: context.membershipError || "No company membership found." });
        setLoading(false);
        return;
      }
      await loadAttendance(month);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadAttendance(month);
  }, [month, ctx?.companyId]);

  async function loadAttendance(monthValue: string) {
    const [start, end] = getDaysRange(monthValue);
    const { data, error } = await supabase
      .from("erp_attendance_days")
      .select("id, att_date, status, in_time, out_time, notes")
      .gte("att_date", start)
      .lte("att_date", end)
      .order("att_date", { ascending: true });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setAttendance(data || []);
  }

  if (loading) {
    return <div style={pageWrapper}>Loading attendance…</div>;
  }

  return (
    <div style={pageWrapper}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>My Attendance</h1>
          <p style={{ marginTop: 6, color: "#4b5563" }}>
            Read-only attendance summary by month.
          </p>
        </div>
        <a href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← ERP Home</a>
      </div>

      {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#6b7280" }}>Month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={cardStyle}>
        {attendance.length === 0 ? (
          <p style={{ color: "#6b7280", fontStyle: "italic" }}>No attendance entries yet.</p>
        ) : (
          <table style={listTable}>
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
              {attendance.map((day) => (
                <tr key={day.id}>
                  <td style={tdStyle}>{day.att_date}</td>
                  <td style={tdStyle}><span style={badgeStyle(day.status)}>{day.status.replace("_", " ")}</span></td>
                  <td style={tdStyle}>{day.in_time || "—"}</td>
                  <td style={tdStyle}>{day.out_time || "—"}</td>
                  <td style={tdStyle}>{day.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
