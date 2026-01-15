import { supabase } from "../supabaseClient";

export type AttendancePayrollSummaryRow = {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  designation_name: string | null;
  period_start: string | null;
  period_end: string | null;
  calendar_days: number | null;
  present_days: number | null;
  absent_days: number | null;
  leave_days: number | null;
  paid_days: number | null;
  manual_ot_hours: number | null;
  gross_pay: number | null;
  net_pay: number | null;
};

export type AttendanceExceptionRow = {
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  issue_key: string | null;
  details: string | null;
};

export type AttendanceRegisterRow = {
  work_date: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  shift_name: string | null;
  status: string | null;
  remarks: string | null;
};

function normalizeError(error: { message?: string } | null, fallback: string) {
  if (!error) return new Error(fallback);
  return new Error(error.message || fallback);
}

export async function getAttendancePayrollSummary(
  runId: string
): Promise<AttendancePayrollSummaryRow[]> {
  const { data, error } = await supabase.rpc("erp_report_attendance_payroll_summary", {
    p_run_id: runId,
  });
  if (error) throw normalizeError(error, "Failed to load attendance payroll summary");
  return Array.isArray(data) ? (data as AttendancePayrollSummaryRow[]) : [];
}

export async function getAttendanceExceptions(input: {
  start: string;
  end: string;
  runId?: string | null;
}): Promise<AttendanceExceptionRow[]> {
  const { data, error } = await supabase.rpc("erp_report_attendance_exceptions", {
    p_start: input.start,
    p_end: input.end,
    p_run_id: input.runId ?? null,
  });
  if (error) throw normalizeError(error, "Failed to load attendance exceptions");
  return Array.isArray(data) ? (data as AttendanceExceptionRow[]) : [];
}

export async function getAttendanceRegister(input: {
  start: string;
  end: string;
}): Promise<AttendanceRegisterRow[]> {
  const { data, error } = await supabase.rpc("erp_report_attendance_register", {
    p_start: input.start,
    p_end: input.end,
  });
  if (error) throw normalizeError(error, "Failed to load attendance register");
  return Array.isArray(data) ? (data as AttendanceRegisterRow[]) : [];
}
