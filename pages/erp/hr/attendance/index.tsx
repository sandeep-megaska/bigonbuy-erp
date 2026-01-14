import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const pageWrapper: React.CSSProperties = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1400,
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

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f3f4f6",
};

const selectCellStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "4px",
  fontSize: 12,
  width: "100%",
};

const statusOptions = [
  { value: "", label: "—" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "half_day", label: "Half Day" },
  { value: "leave", label: "Leave" },
  { value: "holiday", label: "Holiday" },
  { value: "weekoff", label: "Weekoff" },
];

type Employee = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

type AttendanceDay = {
  id: string;
  employee_id: string;
  att_date: string;
  status: string;
};

function getMonthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDaysInMonth(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const days: string[] = [];
  while (start.getMonth() === month - 1) {
    days.push(start.toISOString().slice(0, 10));
    start.setDate(start.getDate() + 1);
  }
  return days;
}

export default function HrAttendancePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined as string | undefined });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceDay[]>([]);
  const [month, setMonth] = useState(getMonthValue(new Date()));
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canManage = useMemo(
    () => ["owner", "admin", "hr", "payroll"].includes(ctx?.roleKey ?? ""),
    [ctx?.roleKey]
  );
  const days = useMemo(() => getDaysInMonth(month), [month]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceDay>();
    attendance.forEach((row) => {
      map.set(`${row.employee_id}-${row.att_date}`, row);
    });
    return map;
  }, [attendance]);

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
      await loadEmployees();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadAttendance();
  }, [ctx?.companyId, month, employees.length]);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .order("full_name", { ascending: true });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setEmployees(data || []);
  }

  async function loadAttendance() {
    const [start, end] = [days[0], days[days.length - 1]];
    if (!start || !end) return;
    const { data, error } = await supabase
      .from("erp_attendance_days")
      .select("id, employee_id, att_date, status")
      .gte("att_date", start)
      .lte("att_date", end);
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setAttendance(data || []);
  }

  async function handleStatusChange(employeeId: string, attDate: string, status: string) {
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/Payroll can edit attendance." });
      return;
    }
    if (!status) return;
    const key = `${employeeId}-${attDate}`;
    setSavingKey(key);
    const { error } = await supabase.rpc("erp_attendance_day_upsert", {
      p_employee_id: employeeId,
      p_att_date: attDate,
      p_status: status,
      p_in_time: null,
      p_out_time: null,
      p_notes: null,
    });
    if (error) {
      setToast({ type: "error", message: error.message });
      setSavingKey(null);
      return;
    }
    await loadAttendance();
    setSavingKey(null);
  }

  if (loading) {
    return <div style={pageWrapper}>Loading attendance…</div>;
  }

  return (
    <div style={pageWrapper}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Attendance</h1>
          <p style={{ marginTop: 6, color: "#4b5563" }}>
            Mark daily attendance by month.
          </p>
        </div>
        <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← HR Home</a>
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
        {employees.length === 0 ? (
          <p style={{ color: "#6b7280", fontStyle: "italic" }}>No employees found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: "left" }}>Employee</th>
                  {days.map((day) => (
                    <th key={day} style={thStyle}>
                      {day.slice(8, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {employee.full_name || "Employee"}
                      {employee.employee_code ? (
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{employee.employee_code}</div>
                      ) : null}
                    </td>
                    {days.map((day) => {
                      const key = `${employee.id}-${day}`;
                      const record = attendanceMap.get(key);
                      return (
                        <td key={day} style={tdStyle}>
                          <select
                            style={selectCellStyle}
                            value={record?.status || ""}
                            onChange={(e) => handleStatusChange(employee.id, day, e.target.value)}
                            disabled={savingKey === key}
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
