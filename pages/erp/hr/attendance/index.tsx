import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../../components/erp/ErpShell";
import { supabase } from "../../../../lib/supabaseClient";

import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";



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

type AttendanceDayDetail = AttendanceDayRow & {
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  work_minutes: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  ot_minutes: number | null;
  day_fraction: number | null;
  shift_id: string | null;
  erp_hr_shifts?: { code?: string | null; name?: string | null } | null;
};

type AttendancePeriod = {
  status: "open" | "frozen";
  frozen_at: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type AttendanceSummaryRow = {
  employee_id: string;
  present_days_computed: number | null;
  absent_days_computed: number | null;
  paid_leave_days_computed: number | null;
  ot_minutes_computed: number | null;
  present_days_override: number | null;
  absent_days_override: number | null;
  paid_leave_days_override: number | null;
  ot_minutes_override: number | null;
  use_override: boolean;
  present_days_effective: number | null;
  absent_days_effective: number | null;
  paid_leave_days_effective: number | null;
  ot_minutes_effective: number | null;
  override_notes: string | null;
};

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorEmployee, setEditorEmployee] = useState<EmployeeRow | null>(null);
  const [editorDay, setEditorDay] = useState<string | null>(null);
  const [editorRow, setEditorRow] = useState<AttendanceDayDetail | null>(null);
  const [editorForm, setEditorForm] = useState({
    checkInAt: "",
    checkOutAt: "",
    notes: "",
    statusOverride: "unmarked",
  });
  const [summaryRows, setSummaryRows] = useState<AttendanceSummaryRow[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideEmployee, setOverrideEmployee] = useState<EmployeeRow | null>(null);
  const [overrideExists, setOverrideExists] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    presentDays: "",
    absentDays: "",
    paidLeaveDays: "",
    otHours: "",
    useOverride: true,
    notes: "",
  });

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

  const summaryMap = useMemo(() => {
    return summaryRows.reduce<Record<string, AttendanceSummaryRow>>((acc, row) => {
      acc[row.employee_id] = row;
      return acc;
    }, {});
  }, [summaryRows]);

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

  const overrideSummary = overrideEmployee ? summaryMap[overrideEmployee.id] : undefined;

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

  useEffect(() => {
    if (!ctx?.companyId || !monthMeta || !canManage) return;
    if (employees.length === 0) {
      setSummaryRows([]);
      return;
    }
    loadAttendanceSummary(monthMeta);
  }, [ctx?.companyId, monthMeta, canManage, employees]);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .in("lifecycle_status", ["active", "on_notice"])
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

  async function loadAttendanceSummary(meta: MonthMeta) {
    const employeeIds = employees.map((employee) => employee.id);
    if (employeeIds.length === 0) {
      setSummaryRows([]);
      return;
    }

    const { data, error } = await supabase.rpc("erp_attendance_month_employee_summary", {
      p_month: meta.monthStart,
      p_employee_ids: employeeIds,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setSummaryRows((data as AttendanceSummaryRow[]) || []);
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

  async function handleOpenOverride(employee: EmployeeRow) {
    if (!monthMeta) return;
    setOverrideEmployee(employee);
    setOverrideOpen(true);
    setOverrideLoading(true);
    setOverrideExists(false);

    const { data, error } = await supabase.rpc("erp_attendance_month_override_get", {
      p_month: monthMeta.monthStart,
      p_employee_id: employee.id,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setOverrideLoading(false);
      return;
    }

    const row = data as any;
    const hasOverride = Boolean(row);

    setOverrideExists(hasOverride);
    setOverrideForm({
      presentDays: formatNumberInput(row?.present_days_override),
      absentDays: formatNumberInput(row?.absent_days_override),
      paidLeaveDays: formatNumberInput(row?.paid_leave_days_override),
      otHours: formatHoursInput(row?.ot_minutes_override),
      useOverride: row?.use_override ?? true,
      notes: row?.notes ?? "",
    });

    setOverrideLoading(false);
  }

  async function handleSaveOverride() {
    if (!monthMeta || !overrideEmployee) return;

    const presentDays = parseOptionalNumber(overrideForm.presentDays);
    const absentDays = parseOptionalNumber(overrideForm.absentDays);
    const paidLeaveDays = parseOptionalNumber(overrideForm.paidLeaveDays);
    const otHours = parseOptionalNumber(overrideForm.otHours);
    const otMinutes = otHours === null ? null : Math.round(otHours * 60);

    setActionLoading("save-override");

    const { error } = await supabase.rpc("erp_attendance_month_override_upsert", {
      p_month: monthMeta.monthStart,
      p_employee_id: overrideEmployee.id,
      p_present_days: presentDays,
      p_absent_days: absentDays,
      p_paid_leave_days: paidLeaveDays,
      p_ot_minutes: otMinutes,
      p_use_override: overrideForm.useOverride,
      p_notes: overrideForm.notes || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setActionLoading(null);
      return;
    }

    setToast({ type: "success", message: "Attendance override saved." });
    await loadAttendanceSummary(monthMeta);
    setActionLoading(null);
    closeOverride();
  }

  async function handleClearOverride() {
    if (!monthMeta || !overrideEmployee) return;

    setActionLoading("clear-override");
    const { error } = await supabase.rpc("erp_attendance_month_override_clear", {
      p_month: monthMeta.monthStart,
      p_employee_id: overrideEmployee.id,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setActionLoading(null);
      return;
    }

    setToast({ type: "success", message: "Attendance override cleared." });
    await loadAttendanceSummary(monthMeta);
    setActionLoading(null);
    closeOverride();
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
    const employee = employees.find((item) => item.id === employeeId) || null;
    setEditorEmployee(employee);
    setEditorDay(day);
    setEditorOpen(true);
    await loadAttendanceDetail(employeeId, day);
  }

  async function loadAttendanceDetail(employeeId: string, day: string) {
    setEditorLoading(true);
    const { data, error } = await supabase
      .from("erp_hr_attendance_days")
      .select(
        "employee_id, day, status, source, check_in_at, check_out_at, notes, work_minutes, late_minutes, early_leave_minutes, ot_minutes, day_fraction, shift_id, erp_hr_shifts(code, name)"
      )
      .eq("employee_id", employeeId)
      .eq("day", day)
      .maybeSingle();

    if (error) {
      setToast({ type: "error", message: error.message });
      setEditorLoading(false);
      return;
    }

    const detail: AttendanceDayDetail = data
      ? {
          employee_id: data.employee_id,
          day: data.day,
          status: data.status,
          source: data.source,
          check_in_at: data.check_in_at,
          check_out_at: data.check_out_at,
          notes: data.notes,
          work_minutes: data.work_minutes,
          late_minutes: data.late_minutes,
          early_leave_minutes: data.early_leave_minutes,
          ot_minutes: data.ot_minutes,
          day_fraction: data.day_fraction,
          shift_id: data.shift_id,
          erp_hr_shifts: Array.isArray((data as any).erp_hr_shifts)
  ? (data as any).erp_hr_shifts[0] ?? null
  : (data as any).erp_hr_shifts ?? null,

        }
      : {
          employee_id: employeeId,
          day,
          status: "unmarked",
          source: null,
          check_in_at: null,
          check_out_at: null,
          notes: null,
          work_minutes: null,
          late_minutes: null,
          early_leave_minutes: null,
          ot_minutes: null,
          day_fraction: null,
          shift_id: null,
          erp_hr_shifts: null,
        };

    setEditorRow(detail);
    setEditorForm({
      checkInAt: toLocalInputValue(detail.check_in_at),
      checkOutAt: toLocalInputValue(detail.check_out_at),
      notes: detail.notes || "",
      statusOverride: EDITABLE_STATUSES.includes(detail.status) ? detail.status : "unmarked",
    });
    setEditorLoading(false);
  }

  async function handleSaveEditor() {
    if (!editorEmployee || !editorDay || !monthMeta) return;
    if (periodStatus?.status !== "open") {
      setToast({
        type: "error",
        message: periodStatus?.status === "frozen" ? "Attendance period is frozen." : "Month not open.",
      });
      return;
    }

    setActionLoading("save");
    const { error } = await supabase.rpc("erp_attendance_upsert_check_times", {
      p_employee_id: editorEmployee.id,
      p_day: editorDay,
      p_check_in_at: toIsoFromLocal(editorForm.checkInAt),
      p_check_out_at: toIsoFromLocal(editorForm.checkOutAt),
      p_source: "manual",
      p_note: editorForm.notes || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setActionLoading(null);
      return;
    }

    const isLeaveRow = editorRow?.status === "leave" || editorRow?.source === "leave";
    if (!isLeaveRow) {
      const { error: statusError } = await supabase.rpc("erp_hr_attendance_day_status_update", {
        p_employee_id: editorEmployee.id,
        p_day: editorDay,
        p_status: editorForm.statusOverride,
        p_source: "manual",
      });

      if (statusError) {
        setToast({ type: "error", message: statusError.message });
        setActionLoading(null);
        return;
      }
    }

    setToast({ type: "success", message: "Attendance updated." });
    await loadAttendanceMonth(monthMeta);
    await loadAttendanceDetail(editorEmployee.id, editorDay);
    setActionLoading(null);
  }

  async function handleRecomputeMonth() {
    if (!monthMeta) return;
    setActionLoading("recompute-month");
    const { error } = await supabase.rpc("erp_attendance_recompute_month", {
      p_month: monthMeta.monthStart,
      p_employee_ids: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
    } else {
      setToast({ type: "success", message: "Attendance metrics recomputed for the month." });
      await loadAttendanceMonth(monthMeta);
    }
    setActionLoading(null);
  }

  async function handleRecomputeDay() {
    if (!monthMeta || !editorEmployee) return;
    setActionLoading("recompute-day");
    const { error } = await supabase.rpc("erp_attendance_recompute_month", {
      p_month: monthMeta.monthStart,
      p_employee_ids: [editorEmployee.id],
    });

    if (error) {
      setToast({ type: "error", message: error.message });
    } else {
      setToast({ type: "success", message: "Attendance metrics recomputed." });
      await loadAttendanceMonth(monthMeta);
      if (editorDay) {
        await loadAttendanceDetail(editorEmployee.id, editorDay);
      }
    }
    setActionLoading(null);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorEmployee(null);
    setEditorDay(null);
    setEditorRow(null);
  }

  function closeOverride() {
    setOverrideOpen(false);
    setOverrideEmployee(null);
    setOverrideExists(false);
    setOverrideForm({
      presentDays: "",
      absentDays: "",
      paidLeaveDays: "",
      otHours: "",
      useOverride: true,
      notes: "",
    });
  }

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading attendance…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Attendance</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        </div>
      </ErpShell>
    );
  }

  if (!canManage) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={h1Style}>Attendance Month View</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </a>
        </div>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={h1Style}>Attendance Month Grid</h1>
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
          <button
            type="button"
            onClick={handleRecomputeMonth}
            style={secondaryButtonStyle}
            disabled={actionLoading === "recompute-month"}
          >
            {actionLoading === "recompute-month" ? "Recomputing..." : "Recompute Metrics"}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong>{employee.full_name || "Employee"}</strong>
                        {hasSummaryOverride(summaryMap[employee.id]) ? (
                          <span style={overrideBadgeStyle} title="Manual override active">
                            OVR
                          </span>
                        ) : null}
                      </div>
                      <div style={{ color: "#6b7280" }}>
                        {employee.employee_code || "No code"}
                      </div>
                      {summaryMap[employee.id] ? (
                        <div style={summaryMetricsRowStyle}>
                          {renderSummaryMetric({
                            label: "Present",
                            effective: formatDays(summaryMap[employee.id]?.present_days_effective),
                            computed: formatDays(summaryMap[employee.id]?.present_days_computed),
                            showOverride: hasSummaryOverride(summaryMap[employee.id]),
                          })}
                          {renderSummaryMetric({
                            label: "Absent",
                            effective: formatDays(summaryMap[employee.id]?.absent_days_effective),
                            computed: formatDays(summaryMap[employee.id]?.absent_days_computed),
                            showOverride: hasSummaryOverride(summaryMap[employee.id]),
                          })}
                          {renderSummaryMetric({
                            label: "Leave",
                            effective: formatDays(summaryMap[employee.id]?.paid_leave_days_effective),
                            computed: formatDays(summaryMap[employee.id]?.paid_leave_days_computed),
                            showOverride: hasSummaryOverride(summaryMap[employee.id]),
                          })}
                          {renderSummaryMetric({
                            label: "OT",
                            effective: formatOtHours(summaryMap[employee.id]?.ot_minutes_effective),
                            computed: formatOtHours(summaryMap[employee.id]?.ot_minutes_computed),
                            showOverride: hasSummaryOverride(summaryMap[employee.id]),
                          })}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleOpenOverride(employee)}
                        style={inlineButtonStyle}
                      >
                        Override Totals
                      </button>
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
                            disabled={actionLoading === "save" || actionLoading === "recompute-day"}
                            title={
                              isLocked
                                ? "Locked"
                                : "Click to edit attendance details"
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

      {editorOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h2 style={{ margin: 0 }}>Edit Attendance</h2>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  {editorEmployee?.full_name || "Employee"} · {editorDay}
                </p>
              </div>
              <button type="button" onClick={closeEditor} style={ghostButtonStyle}>
                Close
              </button>
            </div>

            {periodStatus?.status !== "open" ? (
              <div style={warningBoxStyle}>
                Attendance period is frozen. Editing is disabled.
              </div>
            ) : null}

            {editorLoading ? (
              <div style={{ padding: "16px 0" }}>Loading details…</div>
            ) : (
              <div style={modalBodyStyle}>
                <div style={modalFormStyle}>
                  <label style={modalLabelStyle}>
                    Check-in
                    <input
                      type="datetime-local"
                      value={editorForm.checkInAt}
                      onChange={(e) =>
                        setEditorForm((prev) => ({ ...prev, checkInAt: e.target.value }))
                      }
                      style={inputStyle}
                      disabled={periodStatus?.status !== "open"}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    Check-out
                    <input
                      type="datetime-local"
                      value={editorForm.checkOutAt}
                      onChange={(e) =>
                        setEditorForm((prev) => ({ ...prev, checkOutAt: e.target.value }))
                      }
                      style={inputStyle}
                      disabled={periodStatus?.status !== "open"}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    Notes
                    <textarea
                      value={editorForm.notes}
                      onChange={(e) => setEditorForm((prev) => ({ ...prev, notes: e.target.value }))}
                      style={textareaStyle}
                      rows={3}
                      disabled={periodStatus?.status !== "open"}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    Status override
                    <select
                      value={editorForm.statusOverride}
                      onChange={(e) =>
                        setEditorForm((prev) => ({ ...prev, statusOverride: e.target.value }))
                      }
                      style={inputStyle}
                      disabled={
                        periodStatus?.status !== "open" ||
                        editorRow?.status === "leave" ||
                        editorRow?.source === "leave"
                      }
                    >
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="unmarked">Unmarked</option>
                    </select>
                    {editorRow?.status === "leave" || editorRow?.source === "leave" ? (
                      <span style={{ color: "#b91c1c", fontSize: 12 }}>
                        Leave entries cannot be overridden by default.
                      </span>
                    ) : null}
                  </label>
                </div>

                <div style={metricsCardStyle}>
                  <h3 style={{ marginTop: 0 }}>Computed Metrics</h3>
                  <div style={metricsGridStyle}>
                    <div>
                      <div style={metricsLabelStyle}>Work minutes</div>
                      <div style={metricsValueStyle}>
                        {formatMetric(editorRow?.work_minutes)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Late minutes</div>
                      <div style={metricsValueStyle}>
                        {formatMetric(editorRow?.late_minutes)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Early leave minutes</div>
                      <div style={metricsValueStyle}>
                        {formatMetric(editorRow?.early_leave_minutes)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>OT minutes</div>
                      <div style={metricsValueStyle}>
                        {formatMetric(editorRow?.ot_minutes)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Day fraction</div>
                      <div style={metricsValueStyle}>
                        {editorRow?.day_fraction ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Shift used</div>
                      <div style={metricsValueStyle}>
                        {formatShift(editorRow)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={modalFooterStyle}>
              <button
                type="button"
                onClick={handleRecomputeDay}
                style={secondaryButtonStyle}
                disabled={actionLoading === "recompute-day"}
              >
                {actionLoading === "recompute-day" ? "Recomputing..." : "Recompute"}
              </button>
              <button
                type="button"
                onClick={handleSaveEditor}
                style={primaryButtonStyle}
                disabled={actionLoading === "save" || periodStatus?.status !== "open"}
              >
                {actionLoading === "save" ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {overrideOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={{ ...modalCardStyle, maxWidth: 760 }}>
            <div style={modalHeaderStyle}>
              <div>
                <h2 style={{ margin: 0 }}>Override Month Totals</h2>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  {overrideEmployee?.full_name || "Employee"} · {monthMeta?.label}
                </p>
              </div>
              <button type="button" onClick={closeOverride} style={ghostButtonStyle}>
                Close
              </button>
            </div>

            {overrideLoading ? (
              <div style={{ padding: "16px 0" }}>Loading override…</div>
            ) : (
              <div style={modalBodyStyle}>
                <div style={modalFormStyle}>
                  <label style={modalLabelStyle}>
                    Present days
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={overrideForm.presentDays}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, presentDays: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    Absent days
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={overrideForm.absentDays}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, absentDays: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    Paid leave days
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={overrideForm.paidLeaveDays}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, paidLeaveDays: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={modalLabelStyle}>
                    OT hours
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={overrideForm.otHours}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, otHours: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={overrideForm.useOverride}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, useOverride: e.target.checked }))
                      }
                    />
                    Use override for payroll
                  </label>
                  <label style={modalLabelStyle}>
                    Notes
                    <textarea
                      value={overrideForm.notes}
                      onChange={(e) =>
                        setOverrideForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      style={textareaStyle}
                      rows={3}
                    />
                  </label>
                </div>

                <div style={metricsCardStyle}>
                  <h3 style={{ marginTop: 0 }}>Computed & Effective Totals</h3>
                  <div style={metricsGridStyle}>
                    <div>
                      <div style={metricsLabelStyle}>Present (computed)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.present_days_computed)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Absent (computed)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.absent_days_computed)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Paid leave (computed)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.paid_leave_days_computed)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>OT hours (computed)</div>
                      <div style={metricsValueStyle}>
                        {formatOtHours(overrideSummary?.ot_minutes_computed)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Present (effective)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.present_days_effective)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Absent (effective)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.absent_days_effective)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>Paid leave (effective)</div>
                      <div style={metricsValueStyle}>
                        {formatDays(overrideSummary?.paid_leave_days_effective)}
                      </div>
                    </div>
                    <div>
                      <div style={metricsLabelStyle}>OT hours (effective)</div>
                      <div style={metricsValueStyle}>
                        {formatOtHours(overrideSummary?.ot_minutes_effective)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={modalFooterStyle}>
              {overrideExists ? (
                <button
                  type="button"
                  onClick={handleClearOverride}
                  style={secondaryButtonStyle}
                  disabled={actionLoading === "clear-override"}
                >
                  {actionLoading === "clear-override" ? "Clearing..." : "Clear Override"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleSaveOverride}
                style={primaryButtonStyle}
                disabled={actionLoading === "save-override"}
              >
                {actionLoading === "save-override" ? "Saving..." : "Save Override"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </ErpShell>
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

function toLocalInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoFromLocal(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function formatShift(row: AttendanceDayDetail | null) {
  if (!row) return "—";
  const shift = row.erp_hr_shifts;
  if (shift?.code || shift?.name) {
    return `${shift?.code || "Shift"}${shift?.name ? ` · ${shift?.name}` : ""}`;
  }
  return row.shift_id || "—";
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const fixed = Number(value).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatOtHours(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const fixed = (Number(minutes) / 60).toFixed(2);
  return `${fixed}h`;
}

function formatNumberInput(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  const fixed = Number(value).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatHoursInput(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "";
  const fixed = (Number(minutes) / 60).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function hasSummaryOverride(summary: AttendanceSummaryRow | undefined) {
  return Boolean(summary?.use_override);
}

function renderSummaryMetric({
  label,
  effective,
  computed,
  showOverride,
}: {
  label: string;
  effective: string;
  computed: string;
  showOverride: boolean;
}) {
  return (
    <div style={summaryMetricStyle}>
      <div style={summaryMetricLabelStyle}>{label}</div>
      <div style={summaryMetricValueStyle}>
        {effective}
        {showOverride ? (
          <span style={summaryOverrideBadgeStyle} title="Manual override active">
            OVR
          </span>
        ) : null}
      </div>
      {showOverride ? <div style={summaryComputedStyle}>Computed: {computed}</div> : null}
    </div>
  );
}

const headerStyle: CSSProperties = {
  ...pageHeaderStyle,
  marginBottom: 20,
};

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const sectionStyle: CSSProperties = {
  ...sharedCardStyle,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

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

const overrideBadgeStyle: CSSProperties = {
  backgroundColor: "#1d4ed8",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 999,
  letterSpacing: 0.4,
};

const summaryMetricsRowStyle: CSSProperties = {
  marginTop: 8,
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  color: "#4b5563",
  fontSize: 12,
};

const summaryMetricStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const summaryMetricLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
};

const summaryMetricValueStyle: CSSProperties = {
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "#111827",
};

const summaryComputedStyle: CSSProperties = {
  fontSize: 11,
  color: "#888",
};

const summaryOverrideBadgeStyle: CSSProperties = {
  backgroundColor: "#e0f2ff",
  color: "#0369a1",
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 999,
  textTransform: "uppercase",
};

const inlineButtonStyle: CSSProperties = {
  marginTop: 8,
  border: "none",
  background: "transparent",
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  padding: 0,
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

const warningButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: "#f97316",
  borderColor: "#f97316",
};

const ghostButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  backgroundColor: "#fff",
  color: "#111827",
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

const warningBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  backgroundColor: "#fff7ed",
  border: "1px solid #fed7aa",
  color: "#9a3412",
  marginBottom: 16,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  width: "100%",
  maxWidth: 880,
  padding: 24,
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.2)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 16,
};

const modalBodyStyle: CSSProperties = {
  display: "flex",
  gap: 24,
  flexWrap: "wrap",
};

const modalFormStyle: CSSProperties = {
  flex: "1 1 320px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const modalLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 600,
  color: "#111827",
};

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  color: "#111827",
};

const textareaStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  minHeight: 80,
  resize: "vertical",
};

const metricsCardStyle: CSSProperties = {
  flex: "1 1 280px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  padding: 16,
};

const metricsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};

const metricsLabelStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
};

const metricsValueStyle: CSSProperties = {
  fontWeight: 600,
  color: "#111827",
};

const modalFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 20,
  flexWrap: "wrap",
};
