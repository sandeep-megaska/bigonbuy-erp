import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const STATUS_CODES: Record<string, string> = {
  present: "P",
  absent: "A",
  leave: "L",
  holiday: "H",
  weekly_off: "WO",
  unmarked: "U",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  holiday: "Holiday",
  weekly_off: "Week Off",
  unmarked: "Unmarked",
};

const EDITABLE_STATUSES = ["unmarked", "present", "absent"];

type EmployeeRow = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

type AttendanceDayRow = {
  employee_id: string;
  day: string;
  status: string;
  source: string | null;
};

type AttendancePeriod = {
  status: "open" | "frozen";
  frozen_at: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type MonthMeta = {
  monthStart: string;
  monthEnd: string;
  daysInMonth: number;
  days: string[];
  label: string;
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceDayRow[]>([]);
  const [periodStatus, setPeriodStatus] = useState<AttendancePeriod | null>(null);
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const monthMeta = useMemo(() => buildMonthMeta(monthValue), [monthValue]);

  const attendanceMap = useMemo(() => {
    return attendanceRows.reduce<Record<string, AttendanceDayRow>>((acc, row) => {
      acc[`${row.employee_id}-${row.day}`] = row;
      return acc;
    }, {});
  }, [attendanceRows]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      present: 0,
      absent: 0,
      leave: 0,
      holiday: 0,
      weekly_off: 0,
      unmarked: 0,
    };

    const totalCells = monthMeta ? employees.length * monthMeta.daysInMonth : 0;

    attendanceRows.forEach((row) => {
      if (counts[row.status] !== undefined) {
        counts[row.status] += 1;
      }
    });

    const recordedTotal = Object.keys(counts).reduce((sum, key) => {
      return sum + counts[key];
    }, 0);

    if (totalCells > recordedTotal) {
      counts.unmarked += totalCells - recordedTotal;
    }

    return counts;
  }, [attendanceRows, employees.length, monthMeta]);

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

      const canManageNow = accessState.isManager || isHr(context.roleKey);
      if (!canManageNow) {
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
    if (!ctx?.companyId || !monthMeta || !canManage) return;
    loadAttendanceMonth(monthMeta);
    loadPeriodStatus(monthMeta.monthStart);
  }, [ctx?.companyId, monthMeta, canManage]);

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

  async function loadAttendanceMonth(meta: MonthMeta) {
    const { data, error } = await supabase
      .from("erp_hr_attendance_days")
      .select("employee_id, day, status, source")
      .gte("day", meta.monthStart)
      .lte("day", meta.monthEnd)
      .order("employee_id", { ascending: true })
      .order("day", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setAttendanceRows((data as AttendanceDayRow[]) || []);
  }

  async function loadPeriodStatus(monthStart: string) {
    const { data, error } = await supabase
      .from("erp_hr_attendance_periods")
      .select("status, frozen_at")
      .eq("month", monthStart)
      .maybeSingle();

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setPeriodStatus(
      data
        ? {
            status: data.status,
            frozen_at: data.frozen_at,
          }
        : null
    );
  }

  async function handleGenerateMonth() {
    if (!monthMeta) return;
    setActionLoading("generate");
    const { error } = await supabase.rpc("erp_attendance_generate_month", {
      p_month: monthMeta.monthStart,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
    } else {
      setToast({ type: "success", message: "Attendance month generated." });
      await loadAttendanceMonth(monthMeta);
      await loadPeriodStatus(monthMeta.monthStart);
    }
    setActionLoading(null);
  }

  async function handleMarkWeekdaysPresent() {
    if (!monthMeta) return;
    const employeeIds = employees.map((employee) => employee.id);
    if (employeeIds.length === 0) {
      setToast({ type: "error", message: "No employees available to mark." });
      return;
    }

    setActionLoading("mark_weekdays");
    const { error } = await supabase.rpc("erp_attendance_mark_bulk", {
      p_month: monthMeta.monthStart,
      p_employee_ids: employeeIds,
      p_action: "mark_present_weekdays",
    });

    if (error) {
      setToast({ type: "error", message: error.message });
    } else {
      setToast({ type: "success", message: "Weekdays marked present for selected month." });
      await loadAttendanceMonth(monthMeta);
    }
    setActionLoading(null);
  }

  async function handleFreezeToggle() {
    if (!monthMeta) return;
    const isFrozen = periodStatus?.status === "frozen";
    setActionLoading(isFrozen ? "unfreeze" : "freeze");

    const { error } = await supabase.rpc(
      isFrozen ? "erp_attendance_unfreeze_month" : "erp_attendance_freeze_month",
      {
        p_month: monthMeta.monthStart,
      }
    );

    if (error) {
      setToast({ type: "error", message: error.message });
    } else {
      setToast({
        type: "success",
        message: isFrozen ? "Attendance month unfrozen." : "Attendance month frozen.",
      });
      await loadPeriodStatus(monthMeta.monthStart);
    }

    setActionLoading(null);
  }

  async function handleCellClick(employeeId: string, day: string) {
    if (!monthMeta) return;
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/admin users can edit attendance." });
      return;
    }
    if (periodStatus?.status !== "open") {
      setToast({
        type: "error",
        message: periodStatus?.status === "frozen" ? "Attendance period is frozen." : "Month not open.",
      });
      return;
    }

    const row = attendanceMap[`${employeeId}-${day}`];
    if (row?.status === "leave" || row?.source === "leave") {
      setToast({ type: "error", message: "Leave entries cannot be edited." });
      return;
    }

    const currentStatus = row?.status || "unmarked";
    const nextStatus = nextEditableStatus(currentStatus);

    setActionLoading("cell");
    const { error } = await supabase.rpc("erp_hr_attendance_set_day", {
      p_employee_id: employeeId,
      p_day: day,
      p_status: nextStatus,
      p_check_in: null,
      p_check_out: null,
      p_notes: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setActionLoading(null);
      return;
    }

    setAttendanceRows((prev) => {
      const next = [...prev];
      const index = next.findIndex(
        (item) => item.employee_id === employeeId && item.day === day
      );
      if (index >= 0) {
        next[index] = {
          ...next[index],
          status: nextStatus,
          source: "manual",
        };
      } else {
        next.push({
          employee_id: employeeId,
          day,
          status: nextStatus,
          source: "manual",
        });
      }
      return next;
    });

    setActionLoading(null);
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

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Attendance</p>
        <h1 style={titleStyle}>Attendance Month View</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </a>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={titleStyle}>Attendance Month Grid</h1>
          <p style={subtitleStyle}>Review and update attendance across the month.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr" style={linkStyle}>
            ← Back to HR Home
          </a>
          <button
            type="button"
            onClick={handleFreezeToggle}
            style={periodStatus?.status === "frozen" ? warningButtonStyle : primaryButtonStyle}
            disabled={actionLoading === "freeze" || actionLoading === "unfreeze"}
          >
            {periodStatus?.status === "frozen" ? "Unfreeze Month" : "Freeze Month"}
          </button>
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
          <div style={toolbarRightStyle}>
            <span style={metaLabelStyle}>
              Employees: <strong>{employees.length}</strong>
            </span>
            <span style={metaLabelStyle}>
              Days: <strong>{monthMeta?.daysInMonth ?? 0}</strong>
            </span>
            <span style={metaLabelStyle}>
              Status: <strong>{periodStatus?.status || "not generated"}</strong>
            </span>
          </div>
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={handleGenerateMonth}
            style={secondaryButtonStyle}
            disabled={actionLoading === "generate"}
          >
            {actionLoading === "generate" ? "Generating..." : "Generate Month"}
          </button>
          <button
            type="button"
            onClick={handleMarkWeekdaysPresent}
            style={secondaryButtonStyle}
            disabled={actionLoading === "mark_weekdays"}
          >
            {actionLoading === "mark_weekdays" ? "Marking..." : "Mark Weekdays Present"}
          </button>
        </div>

        <div style={legendStyle}>
          {Object.keys(STATUS_CODES).map((key) => (
            <div key={key} style={legendItemStyle}>
              <span style={legendBadgeStyle}>{STATUS_CODES[key]}</span>
              <span>{STATUS_LABELS[key]}</span>
              <span style={legendCountStyle}>{statusCounts[key] ?? 0}</span>
            </div>
          ))}
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={stickyHeaderStyle}>Employee</th>
                {monthMeta?.days.map((day) => (
                  <th key={day} style={dayHeaderStyle}>
                    {day.split("-")[2]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={(monthMeta?.daysInMonth ?? 0) + 1} style={emptyCellStyle}>
                    No employees found.
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <tr key={employee.id}>
                    <td style={stickyCellStyle}>
                      <strong>{employee.full_name || "Employee"}</strong>
                      <div style={{ color: "#6b7280" }}>
                        {employee.employee_code || employee.id}
                      </div>
                    </td>
                    {monthMeta?.days.map((day) => {
                      const row = attendanceMap[`${employee.id}-${day}`];
                      const status = row?.status || "unmarked";
                      const statusCode = STATUS_CODES[status] || "U";
                      const isLocked =
                        periodStatus?.status !== "open" ||
                        row?.status === "leave" ||
                        row?.source === "leave";
                      return (
                        <td key={`${employee.id}-${day}`} style={gridCellStyle}>
                          <button
                            type="button"
                            onClick={() => handleCellClick(employee.id, day)}
                            style={{
                              ...cellButtonStyle,
                              ...(status === "present" ? presentCellStyle : null),
                              ...(status === "absent" ? absentCellStyle : null),
                              ...(status === "leave" ? leaveCellStyle : null),
                              ...(status === "holiday" ? holidayCellStyle : null),
                              ...(status === "weekly_off" ? weekOffCellStyle : null),
                              ...(status === "unmarked" ? unmarkedCellStyle : null),
                              ...(isLocked ? lockedCellStyle : null),
                            }}
                            disabled={isLocked || actionLoading === "cell"}
                            title={
                              isLocked
                                ? "Locked"
                                : `Click to set ${STATUS_LABELS[nextEditableStatus(status)]}`
                            }
                          >
                            {statusCode}
                          </button>
                        </td>
                      );
                    })}
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

function buildMonthMeta(value: string): MonthMeta | null {
  if (!value) return null;
  const [yearString, monthString] = value.split("-");
  const year = Number(yearString);
  const month = Number(monthString);
  if (!year || !month) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${yearString}-${monthString}-01`;
  const monthEnd = `${yearString}-${monthString}-${String(daysInMonth).padStart(2, "0")}`;

  const days: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayValue = String(day).padStart(2, "0");
    days.push(`${yearString}-${monthString}-${dayValue}`);
  }

  return {
    monthStart,
    monthEnd,
    daysInMonth,
    days,
    label: `${yearString}-${monthString}`,
  };
}

function nextEditableStatus(current: string) {
  const normalized = current || "unmarked";
  const index = EDITABLE_STATUSES.indexOf(normalized);
  const nextIndex = index >= 0 ? (index + 1) % EDITABLE_STATUSES.length : 0;
  return EDITABLE_STATUSES[nextIndex];
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

const toolbarRightStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
};

const metaLabelStyle: CSSProperties = {
  color: "#6b7280",
};

const actionsStyle: CSSProperties = {
  display: "flex",
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
  overflow: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  minWidth: 900,
};

const stickyHeaderStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  backgroundColor: "#f9fafb",
  color: "#374151",
  position: "sticky",
  left: 0,
  zIndex: 1,
  minWidth: 200,
};

const dayHeaderStyle: CSSProperties = {
  textAlign: "center",
  padding: "8px 6px",
  backgroundColor: "#f9fafb",
  color: "#374151",
  minWidth: 38,
};

const stickyCellStyle: CSSProperties = {
  padding: "10px 12px",
  borderTop: "1px solid #e5e7eb",
  backgroundColor: "#fff",
  position: "sticky",
  left: 0,
  zIndex: 1,
  minWidth: 200,
};

const gridCellStyle: CSSProperties = {
  padding: "6px",
  borderTop: "1px solid #e5e7eb",
  textAlign: "center",
};

const emptyCellStyle: CSSProperties = {
  padding: "16px",
  borderTop: "1px solid #e5e7eb",
  textAlign: "center",
};

const cellButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  fontWeight: 600,
  color: "#111827",
};

const presentCellStyle: CSSProperties = { backgroundColor: "#dcfce7", borderColor: "#86efac" };

const absentCellStyle: CSSProperties = { backgroundColor: "#fee2e2", borderColor: "#fecaca" };

const leaveCellStyle: CSSProperties = { backgroundColor: "#e0f2fe", borderColor: "#bae6fd" };

const holidayCellStyle: CSSProperties = { backgroundColor: "#fef9c3", borderColor: "#fde68a" };

const weekOffCellStyle: CSSProperties = { backgroundColor: "#f3e8ff", borderColor: "#e9d5ff" };

const unmarkedCellStyle: CSSProperties = { backgroundColor: "#f3f4f6", borderColor: "#e5e7eb" };

const lockedCellStyle: CSSProperties = { cursor: "not-allowed", opacity: 0.65 };

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

const warningButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#f97316",
  borderColor: "#f97316",
  color: "#fff",
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#111827",
  borderColor: "#111827",
  color: "#fff",
};

const legendStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
  padding: "12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
};

const legendItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#374151",
  fontSize: 13,
};

const legendBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  backgroundColor: "#e5e7eb",
  fontWeight: 700,
};

const legendCountStyle: CSSProperties = {
  marginLeft: 4,
  color: "#111827",
  fontWeight: 600,
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
