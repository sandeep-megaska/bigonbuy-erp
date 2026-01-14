import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const ATTENDANCE_STATUSES = ["present", "absent", "leave", "holiday", "weekly_off"] as const;

type EmployeeRow = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

type AttendanceRow = {
  employee_id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type AttendanceDraft = {
  status: string;
  check_in_at: string;
  check_out_at: string;
  notes: string;
};

export default function HrAttendancePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceDraft>>({});

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

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

      await loadEmployees();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadAttendance(selectedDate);
  }, [ctx?.companyId, selectedDate]);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .order("full_name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setEmployees((data as EmployeeRow[]) || []);
  }

  async function loadAttendance(dateValue: string) {
    if (!dateValue) return;
    const { data, error } = await supabase
      .from("erp_hr_attendance_days")
      .select("employee_id, status, check_in_at, check_out_at, notes")
      .eq("day", dateValue);

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    const mapped = (data as AttendanceRow[] | null)?.reduce<Record<string, AttendanceDraft>>(
      (acc, row) => {
        acc[row.employee_id] = {
          status: row.status,
          check_in_at: formatTimeInput(row.check_in_at),
          check_out_at: formatTimeInput(row.check_out_at),
          notes: row.notes || "",
        };
        return acc;
      },
      {}
    ) || {};

    setAttendanceMap(mapped);
  }

  function updateAttendance(employeeId: string, updates: Partial<AttendanceDraft>) {
    setAttendanceMap((prev) => ({
      ...prev,
      [employeeId]: {
        status: prev[employeeId]?.status || "",
        check_in_at: prev[employeeId]?.check_in_at || "",
        check_out_at: prev[employeeId]?.check_out_at || "",
        notes: prev[employeeId]?.notes || "",
        ...updates,
      },
    }));
  }

  async function saveAttendance() {
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/admin/payroll can mark attendance." });
      return;
    }
    if (!selectedDate) return;

    const payloads = employees
      .map((employee) => {
        const draft = attendanceMap[employee.id];
        if (!draft?.status) return null;
        const checkIn = toTimestamp(selectedDate, draft.check_in_at);
        const checkOut = toTimestamp(selectedDate, draft.check_out_at);
        return {
          employee_id: employee.id,
          status: draft.status,
          check_in_at: checkIn,
          check_out_at: checkOut,
          notes: draft.notes || null,
        };
      })
      .filter(Boolean) as Array<{
      employee_id: string;
      status: string;
      check_in_at: string | null;
      check_out_at: string | null;
      notes: string | null;
    }>;

    if (!payloads.length) {
      setToast({ type: "error", message: "Select at least one attendance status before saving." });
      return;
    }

    setSaving(true);
    const results = await Promise.all(
      payloads.map((payload) =>
        supabase.rpc("erp_hr_attendance_set_day", {
          p_employee_id: payload.employee_id,
          p_day: selectedDate,
          p_status: payload.status,
          p_check_in: payload.check_in_at,
          p_check_out: payload.check_out_at,
          p_notes: payload.notes,
        })
      )
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      setToast({ type: "error", message: firstError.message });
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Attendance saved successfully." });
    setSaving(false);
    await loadAttendance(selectedDate);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading attendance…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Attendance</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={titleStyle}>Attendance Day Marking</h1>
          <p style={subtitleStyle}>Select a date and mark attendance for each employee.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr" style={linkStyle}>← Back to HR Home</a>
          <button type="button" onClick={saveAttendance} style={primaryButtonStyle} disabled={saving}>
            {saving ? "Saving..." : "Save Attendance"}
          </button>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={toolbarStyle}>
          <label style={filterLabelStyle}>
            Attendance date
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={inputStyle}
            />
          </label>
          <span style={{ color: "#6b7280" }}>Employees: {employees.length}</span>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>In Time</th>
                <th style={thStyle}>Out Time</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: "center" }}>
                    No employees found.
                  </td>
                </tr>
              ) : (
                employees.map((employee) => {
                  const draft = attendanceMap[employee.id] || {
                    status: "",
                    check_in_at: "",
                    check_out_at: "",
                    notes: "",
                  };
                  return (
                    <tr key={employee.id}>
                      <td style={tdStyle}>
                        <strong>{employee.full_name || "Employee"}</strong>
                        <div style={{ color: "#6b7280" }}>{employee.employee_code || employee.id}</div>
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={draft.status}
                          onChange={(e) => updateAttendance(employee.id, { status: e.target.value })}
                          style={selectStyle}
                        >
                          <option value="">Select status</option>
                          {ATTENDANCE_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="time"
                          value={draft.check_in_at}
                          onChange={(e) =>
                            updateAttendance(employee.id, { check_in_at: e.target.value })
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="time"
                          value={draft.check_out_at}
                          onChange={(e) =>
                            updateAttendance(employee.id, { check_out_at: e.target.value })
                          }
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={draft.notes}
                          onChange={(e) => updateAttendance(employee.id, { notes: e.target.value })}
                          placeholder="Optional notes"
                          style={inputStyle}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toTimestamp(dateValue: string, timeValue?: string) {
  if (!dateValue || !timeValue) return null;
  const date = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const containerStyle: CSSProperties = {
  maxWidth: 1200,
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

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

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
  minWidth: 140,
};

const selectStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
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

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#2563eb",
  borderColor: "#2563eb",
  color: "#fff",
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
