import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { fetchEmployeeSession, type EmployeeSessionContext } from "../../../lib/erp/employeeSession";

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
  const [ctx, setCtx] = useState<EmployeeSessionContext | null>(null);
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
      const context = await fetchEmployeeSession();
      if (!active) return;
      if (!context) {
        router.replace("/erp/employee/login");
        return;
      }
      if (context.mustResetPassword) {
        router.replace("/erp/employee/change-password");
        return;
      }
      setCtx(context);
      await loadAttendance(monthRange);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, monthRange]);

  async function loadAttendance(range: { start: string; end: string } | null) {
    if (!range) return;
    const res = await fetch(`/api/hr/employee/attendance?start=${range.start}&end=${range.end}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setToast({ type: "error", message: data.error || "Unable to load attendance" });
      return;
    }
    setAttendance((data.rows as AttendanceRow[]) || []);
  }

  async function handleLogout() {
    await fetch("/api/hr/employee/auth/logout", { method: "POST" });
    router.replace("/erp/employee/login");
  }

  if (loading) {
    return <div style={pageContainerStyle}>Loading attendance…</div>;
  }

  return (
    <div style={pageContainerStyle}>
      <div style={headerRowStyle}>
        <div>
          <p style={eyebrowStyle}>Employee · Attendance</p>
          <h1 style={titleStyle}>My Attendance</h1>
          <p style={subtitleStyle}>Review your attendance records by month.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/erp/employee" style={linkButtonStyle}>
            ← Back to Portal Home
          </Link>
          <button type="button" onClick={handleLogout} style={secondaryButtonStyle}>
            Sign Out
          </button>
        </div>
      </div>

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
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {ctx?.displayName} · {ctx?.employeeCode}
          </div>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Day</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Check-in</th>
                <th style={thStyle}>Check-out</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.day}</td>
                  <td style={tdStyle}>{STATUS_LABELS[row.status] || row.status}</td>
                  <td style={tdStyle}>{row.check_in_at ? formatTime(row.check_in_at) : "—"}</td>
                  <td style={tdStyle}>{row.check_out_at ? formatTime(row.check_out_at) : "—"}</td>
                  <td style={tdStyle}>{row.notes || "—"}</td>
                </tr>
              ))}
              {attendance.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: "center" }}>
                    No attendance entries for this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatTime(value: string) {
  try {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_e) {
    return value;
  }
}

const pageContainerStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  padding: 24,
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 24,
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: 1,
  color: "#6b7280",
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: "6px 0",
  fontSize: 28,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
};

const linkButtonStyle: CSSProperties = {
  textDecoration: "none",
  color: "#2563eb",
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 600,
  cursor: "pointer",
};

const sectionStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 16,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 16,
};

const filterLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#6b7280",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f3f4f6",
  fontSize: 14,
  color: "#111827",
};

const successBoxStyle: CSSProperties = {
  marginBottom: 12,
  padding: 10,
  borderRadius: 10,
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
  color: "#065f46",
};

const errorBoxStyle: CSSProperties = {
  marginBottom: 12,
  padding: 10,
  borderRadius: 10,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
};
