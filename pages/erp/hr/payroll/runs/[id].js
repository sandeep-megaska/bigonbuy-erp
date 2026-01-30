import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

const emptyOtForm = { units: "", rate: "", amount: "", notes: "" };

export default function PayrollRunDetailPage() {
  const router = useRouter();
  const { id: runId } = router.query;
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [itemStatuses, setItemStatuses] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [toast, setToast] = useState(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [financePreview, setFinancePreview] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeConfig, setFinanceConfig] = useState(null);
  const [financeConfigLoading, setFinanceConfigLoading] = useState(false);
  const [financeConfigError, setFinanceConfigError] = useState("");
  const [financeError, setFinanceError] = useState("");
  const [financePosting, setFinancePosting] = useState(null);
  const [financePostError, setFinancePostError] = useState("");
  const [financePostLoading, setFinancePostLoading] = useState(false);
  const [overrideDrafts, setOverrideDrafts] = useState({});
  const [overrideSaving, setOverrideSaving] = useState({});
  const [attendanceSummaryRows, setAttendanceSummaryRows] = useState([]);

  const [otOpen, setOtOpen] = useState(false);
  const [otLoading, setOtLoading] = useState(false);
  const [otSaving, setOtSaving] = useState(false);
  const [otError, setOtError] = useState("");
  const [otItem, setOtItem] = useState(null);
  const [otForm, setOtForm] = useState(emptyOtForm);
  const [otType, setOtType] = useState("normal");
  const [otLineMap, setOtLineMap] = useState({ normal: null, holiday: null });
  const [otCodeMap, setOtCodeMap] = useState({ normal: "OT_NORMAL", holiday: "OT_HOLIDAY" });

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "hr", "payroll"].includes(ctx.roleKey);
  }, [ctx]);

  const canFinanceWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const statusMap = useMemo(() => {
    const map = new Map();
    (itemStatuses || []).forEach((row) => {
      if (row?.payroll_item_id) map.set(row.payroll_item_id, row);
    });
    return map;
  }, [itemStatuses]);

  const payslipMap = useMemo(() => {
    const map = new Map();
    (payslips || []).forEach((row) => {
      if (row?.employee_id) map.set(row.employee_id, row);
    });
    return map;
  }, [payslips]);

  const attendanceSummaryByEmployeeId = useMemo(() => {
    return (attendanceSummaryRows || []).reduce((acc, row) => {
      if (row?.employee_id) acc[row.employee_id] = row;
      return acc;
    }, {});
  }, [attendanceSummaryRows]);

  const isRunFinalized = run?.status === "finalized";
  const attendanceStatus = run?.attendance_period_status || "not_generated";
  const attendanceLabel = attendanceStatus === "not_generated" ? "not generated" : attendanceStatus;
  const isAttendanceFrozen = attendanceStatus === "frozen";
  const hasFinanceConfig = Boolean(
    financeConfig?.salary_expense_account_id && financeConfig?.payroll_payable_account_id
  );
  const financePreviewReady = Boolean(financePreview?.can_post);
  const financeTotalsNet = Number(financePreview?.totals?.net_pay ?? 0);
  const canPostFinance =
    financePreviewReady &&
    isRunFinalized &&
    hasFinanceConfig &&
    financeTotalsNet > 0 &&
    canFinanceWrite;
  const financePosted = Boolean(financePosting?.posted);
  const financeJournal = financePosting?.journal || null;
  const financeJournalLink =
    financePosting?.link || (financeJournal?.id ? `/erp/finance/journals/${financeJournal.id}` : null);

  useEffect(() => {
    if (!items?.length) {
      setOverrideDrafts({});
      return;
    }
    const nextDrafts = {};
    items.forEach((item) => {
      nextDrafts[item.id] = {
        payable: item.payable_days_override !== null && item.payable_days_override !== undefined
          ? item.payable_days_override.toString()
          : "",
        lop: item.lop_days_override !== null && item.lop_days_override !== undefined ? item.lop_days_override.toString() : "",
      };
    });
    setOverrideDrafts(nextDrafts);
  }, [items]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !runId) return;
    let active = true;
    (async () => {
      setErr("");
      const companyId = ctx.companyId;
      const [runResponse, itemsResponse, employeesResponse, statusResponse] = await Promise.all([
        fetch("/api/erp/payroll/runs/get", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ runId }),
        }),
        fetch("/api/erp/payroll/items/list", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ payrollRunId: runId }),
        }),
        supabase
          .from("erp_payroll_eligible_employees_v")
          .select("employee_id, full_name, employee_code")
          .eq("company_id", companyId)
          .order("full_name", { ascending: true }),
        supabase.rpc("erp_payroll_run_items_status", {
          p_payroll_run_id: runId,
        }),
      ]);

      const [runPayload, itemsPayload] = await Promise.all([runResponse.json(), itemsResponse.json()]);
      const { data: employeesData, error: employeesErr } = employeesResponse;
      const { data: statusData, error: statusErr } = statusResponse;

      if (!active) return;

      if (!runResponse.ok || !itemsResponse.ok || employeesErr || statusErr) {
        setErr(
          runPayload?.error ||
            itemsPayload?.error ||
            employeesErr?.message ||
            statusErr?.message ||
            "Unable to load payroll run."
        );
        return;
      }

      setRun(runPayload?.run || null);
      if (runPayload?.run) {
        await loadFinancePostingStatus(runPayload.run.id);
      }
      setItems(itemsPayload?.items || []);
      const eligibleEmployees = (employeesData || []).map((row) => ({
        ...row,
        id: row.employee_id ?? row.id,
      }));
      if (process.env.NODE_ENV !== "production") {
        console.info(`[Payroll] Eligible employees returned: ${eligibleEmployees.length}`);
      }
      setEmployees(eligibleEmployees);
      setItemStatuses(statusData || []);
      if (runPayload?.run?.status === "finalized") {
        const { data: payslipData, error: payslipErr } = await supabase.rpc("erp_payroll_run_payslips", {
          p_payroll_run_id: runId,
        });
        if (payslipErr) {
          setErr(payslipErr.message || "Unable to load payslips.");
          return;
        }
        setPayslips(payslipData || []);
      } else {
        setPayslips([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [ctx, runId]);

  useEffect(() => {
    if (!run?.year || !run?.month) return;
    if (!items?.length) {
      setAttendanceSummaryRows([]);
      return;
    }
    let active = true;
    (async () => {
      const monthStart = getMonthStart(run);
      if (!monthStart) return;
      const employeeIds = Array.from(
        new Set(items.map((item) => item.employee_id).filter(Boolean))
      );
      if (employeeIds.length === 0) {
        if (active) setAttendanceSummaryRows([]);
        return;
      }
      const { data, error } = await supabase.rpc("erp_attendance_month_payroll_inputs_get", {
        p_month: monthStart,
        p_employee_ids: employeeIds,
      });
      if (!active) return;
      if (error) {
        setToast({ type: "error", message: error.message });
        return;
      }
      setAttendanceSummaryRows(data || []);
    })();
    return () => {
      active = false;
    };
  }, [run?.year, run?.month, items]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;
    (async () => {
      setFinanceConfigLoading(true);
      setFinanceConfigError("");
      const { data, error } = await supabase.rpc("erp_payroll_finance_posting_config_get");
      if (!active) return;
      if (error) {
        setFinanceConfigError(error.message || "Unable to load finance posting config.");
        setFinanceConfig(null);
      } else {
        setFinanceConfig(data || null);
      }
      setFinanceConfigLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ctx]);

  async function loadFinancePostingStatus(currentRunId = runId) {
    if (!currentRunId || !ctx?.session?.access_token) return;
    setFinancePostError("");
    try {
      const response = await fetch(`/api/erp/payroll/runs/${currentRunId}/finance-post`, {
        method: "GET",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to load finance posting status.");
      }
      setFinancePosting(payload?.post || null);
    } catch (e) {
      setFinancePostError(e.message || "Unable to load finance posting status.");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function getAuthHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };

    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }


  function updateOtForm(key, value, autoAmount = true) {
    setOtForm((prev) => {
      const next = { ...prev, [key]: value };
      if (autoAmount) {
        const unitsNum = Number(next.units || 0);
        const rateNum = Number(next.rate || 0);
        if (Number.isFinite(unitsNum) && Number.isFinite(rateNum)) {
          next.amount = (unitsNum * rateNum).toString();
        }
      }
      return next;
    });
  }

  function applyOtLine(nextType, lineMap) {
    const line = lineMap[nextType];
    setOtType(nextType);
    setOtForm({
      units: line?.units?.toString() || "",
      rate: line?.rate?.toString() || "",
      amount: line?.amount?.toString() || "",
      notes: line?.notes || "",
    });
  }

  async function openOtDrawer(item) {
    setOtItem(item);
    setOtForm(emptyOtForm);
    setOtError("");
    const status = statusMap.get(item?.id);
    if (status?.has_salary_assignment === false) {
      showToast("Assign salary to enable OT and payroll calculations.", "error");
      return;
    }
    setOtOpen(true);
    if (!item?.id) return;
    setOtLoading(true);
    try {
      const response = await fetch("/api/erp/payroll/item-lines/list", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ payrollItemId: item.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load OT line");
      }
      const lines = payload.lines || [];
      const normalLine = lines.find((line) => line.code === "OT_NORMAL") || lines.find((line) => line.code === "OT");
      const holidayLine = lines.find((line) => line.code === "OT_HOLIDAY");
      const nextLineMap = { normal: normalLine || null, holiday: holidayLine || null };
      const nextCodeMap = {
        normal: normalLine?.code || "OT_NORMAL",
        holiday: holidayLine?.code || "OT_HOLIDAY",
      };
      setOtLineMap(nextLineMap);
      setOtCodeMap(nextCodeMap);
      const initialType = holidayLine && !normalLine ? "holiday" : "normal";
      applyOtLine(initialType, nextLineMap);
    } catch (e) {
      setOtError(e.message || "Failed to load OT line");
    } finally {
      setOtLoading(false);
    }
  }

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }

  function formatAmount(value) {
    if (value === null || value === undefined) return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return value;
    return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadFinancePreview() {
    if (!runId) return;
    setFinanceLoading(true);
    setFinanceError("");
    try {
      const { data, error } = await supabase.rpc("erp_payroll_finance_posting_preview", {
        p_run_id: runId,
      });
      if (error) throw error;
      setFinancePreview(data || null);
    } catch (e) {
      setFinanceError(e.message || "Unable to load finance preview.");
    } finally {
      setFinanceLoading(false);
    }
  }

  async function postFinance() {
    if (!runId) return;
    setFinancePostLoading(true);
    setFinancePostError("");
    try {
      const response = await fetch(`/api/erp/payroll/runs/${runId}/finance-post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idempotencyKey: runId,
          notes: `Payroll run ${run?.year}-${String(run?.month || \"\").padStart(2, \"0\")}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to post payroll to finance.");
      }
      setFinancePosting(payload?.post || null);
      showToast("Posted to finance");
    } catch (e) {
      setFinancePostError(e.message || "Failed to post payroll to finance.");
      showToast(e.message || "Failed to post payroll to finance.", "error");
    } finally {
      setFinancePostLoading(false);
    }
  }

  async function saveOt() {
    if (!otItem?.id) return;
    if (!canWrite) return;
    if (isRunFinalized) {
      showToast("Payroll run is finalized; edits are locked", "error");
      return;
    }
    setOtSaving(true);
    setOtError("");
    try {
      const otCode = otCodeMap[otType] || (otType === "holiday" ? "OT_HOLIDAY" : "OT_NORMAL");
      const response = await fetch("/api/erp/payroll/item-lines/upsert", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          payrollItemId: otItem.id,
          code: otCode,
          units: otForm.units,
          rate: otForm.rate,
          amount: otForm.amount,
          notes: otForm.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save OT");
      }

      const recalcResponse = await fetch("/api/erp/payroll/item/recalculate", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ payrollItemId: otItem.id }),
      });
      const recalcPayload = await recalcResponse.json();
      if (!recalcResponse.ok) {
        throw new Error(recalcPayload?.error || "Failed to recalculate payroll item");
      }

      await refreshItems();
      showToast("OT saved");
      setOtOpen(false);
    } catch (e) {
      setOtError(e.message || "Failed to save OT");
      showToast(e.message || "Failed to save OT", "error");
    } finally {
      setOtSaving(false);
    }
  }

  async function refreshItems() {
    if (!ctx?.companyId || !runId) return;
    const [itemsResponse, statusResponse] = await Promise.all([
      fetch("/api/erp/payroll/items/list", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ payrollRunId: runId }),
      }),
      supabase.rpc("erp_payroll_run_items_status", {
        p_payroll_run_id: runId,
      }),
    ]);
    const payload = await itemsResponse.json();
    const { data: statusData, error: statusErr } = statusResponse;
    if (!itemsResponse.ok || statusErr) {
      setErr(payload?.error || statusErr?.message || "Failed to refresh payroll items.");
      return;
    }
    setItems(payload.items || []);
    setItemStatuses(statusData || []);
  }

  async function syncAttendance() {
    if (!ctx?.companyId || !runId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner/payroll can sync attendance.");
      return;
    }
    if (isRunFinalized) {
      setErr("This payroll run is already finalized.");
      return;
    }
    setIsSyncing(true);
    setErr("");
    try {
      const { error } = await supabase.rpc("erp_payroll_run_attach_attendance", {
        p_run_id: runId,
      });
      if (error) throw error;
      await refreshRun();
      await refreshItems();
      showToast("Attendance synced");
    } catch (e) {
      setErr(e.message || "Failed to sync attendance.");
      showToast(e.message || "Failed to sync attendance.", "error");
    } finally {
      setIsSyncing(false);
    }
  }

  function updateOverrideDraft(itemId, key, value) {
    setOverrideDrafts((prev) => {
      const current = prev[itemId] || { payable: "", lop: "" };
      return {
        ...prev,
        [itemId]: {
          ...current,
          [key]: value,
        },
      };
    });
  }

  async function saveOverrides(item) {
    if (!item?.id) return;
    if (!canWrite) {
      showToast("Read-only access", "error");
      return;
    }
    if (isRunFinalized) {
      showToast("Payroll run is finalized; edits are locked", "error");
      return;
    }
    const draft = overrideDrafts[item.id] || { payable: "", lop: "" };
    const payableValue = draft.payable === "" ? null : Number(draft.payable);
    const lopValue = draft.lop === "" ? null : Number(draft.lop);
    if (draft.payable !== "" && !Number.isFinite(payableValue)) {
      showToast("Enter a valid payable override", "error");
      return;
    }
    if (draft.lop !== "" && !Number.isFinite(lopValue)) {
      showToast("Enter a valid LOP override", "error");
      return;
    }
    setOverrideSaving((prev) => ({ ...prev, [item.id]: true }));
    try {
      const { error } = await supabase.rpc("erp_payroll_item_override_update", {
        p_item_id: item.id,
        p_payable_days_override: payableValue,
        p_lop_days_override: lopValue,
      });
      if (error) throw error;
      await refreshItems();
      showToast("Overrides saved");
    } catch (e) {
      showToast(e.message || "Failed to save overrides", "error");
    } finally {
      setOverrideSaving((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function refreshPayslips() {
    if (!ctx?.companyId || !runId) return;
    const { data, error } = await supabase.rpc("erp_payroll_run_payslips", {
      p_payroll_run_id: runId,
    });
    if (error) {
      setErr(error.message || "Failed to refresh payslips.");
      return;
    }
    setPayslips(data || []);
  }

  function formatCtc(value) {
    if (value === null || value === undefined) return "—";
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
  }

  function getSalaryStatusCopy(status) {
    if (!status || status.has_salary_assignment === false) return null;
    const structure = status.structure_name || "Salary structure";
    const ctc = formatCtc(status.ctc_monthly);
    return `${structure} · CTC ${ctc}`;
  }

  async function refreshRun() {
    if (!ctx?.companyId || !runId) return;
    const response = await fetch("/api/erp/payroll/runs/get", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ runId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to refresh payroll run.");
      return;
    }
    setRun(payload?.run || null);
  }

  async function generateItems() {
    if (!ctx?.companyId || !runId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner/payroll can generate payroll items.");
      return;
    }
    if (isRunFinalized) {
      setErr("This payroll run is already finalized.");
      return;
    }
    setIsGenerating(true);
    setErr("");
    const response = await fetch("/api/erp/payroll/runs/generate", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ payrollRunId: runId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Failed to generate payroll items.");
      setIsGenerating(false);
      return;
    }
    await refreshItems();
    showToast("Payroll items generated");
    setIsGenerating(false);
  }

  async function finalizeRun() {
    if (!ctx?.companyId || !runId || !run) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner/payroll can finalize payroll runs.");
      return;
    }
    if (isRunFinalized) {
      setErr("This payroll run is already finalized.");
      return;
    }
    const confirmMessage = isAttendanceFrozen
      ? "Finalize this payroll run? Finalizing will lock OT edits and payroll changes."
      : "Attendance not frozen; figures may change. Finalize this payroll run anyway? Finalizing will lock OT edits and payroll changes.";
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
    setIsFinalizing(true);
    setErr("");
    try {
      const { error: finalizeErr } = await supabase.rpc("erp_payroll_run_finalize", {
        p_payroll_run_id: runId,
      });
      if (finalizeErr) throw finalizeErr;

      await refreshRun();
      await refreshItems();
      await refreshPayslips();
      showToast("Payroll run finalized");
    } catch (e) {
      showToast(e.message || "Failed to finalize payroll run.", "error");
    } finally {
      setIsFinalizing(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading payroll run…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payroll Run</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!run) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payroll Run</h1>
        <p style={{ color: "#b91c1c" }}>{err || "Payroll run not found."}</p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/erp/hr/payroll/runs" style={buttonStyle}>Back to Runs</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Payroll Run</h1>
            <span style={{ ...badgeStyle, ...statusBadgeStyles[run.status || "draft"] }}>
              {run.status || "draft"}
            </span>
          </div>
          <p style={{ marginTop: 6, color: "#555" }}>
            {run.year}-{String(run.month).padStart(2, "0")} · {run.status}
          </p>
          {isRunFinalized && run.finalized_at ? (
            <p style={{ marginTop: 0, color: "#6b7280", fontSize: 12 }}>
              Finalized: {new Date(run.finalized_at).toLocaleString()}
              {run.finalized_by ? ` · By ${run.finalized_by}` : ""}
            </p>
          ) : null}
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr/payroll/runs">← Back to Runs</a>
          <a href="/erp/hr">HR Home</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      {toast ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: toast.type === "error" ? "#fef2f2" : "#ecfdf5",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#a7f3d0"}`,
            borderRadius: 8,
            color: toast.type === "error" ? "#b91c1c" : "#047857",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Payroll Items ({items.length})</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...badgeStyle, ...attendanceBadgeStyles[attendanceStatus] || attendanceBadgeStyles.not_generated }}>
                Attendance: {attendanceLabel}
              </span>
              {!isAttendanceFrozen ? (
                <span style={{ fontSize: 12, color: "#b45309" }}>
                  Attendance not frozen; figures may change.
                </span>
              ) : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canWrite ? (
              <button
                style={{ ...smallButtonStyle, opacity: isRunFinalized || isGenerating ? 0.7 : 1 }}
                onClick={generateItems}
                disabled={isRunFinalized || isGenerating}
              >
                {isGenerating ? "Generating…" : "Generate Items"}
              </button>
            ) : null}
            {canWrite ? (
              <button
                style={{ ...smallButtonStyle, opacity: isRunFinalized || isSyncing ? 0.7 : 1 }}
                onClick={syncAttendance}
                disabled={isRunFinalized || isSyncing}
              >
                {isSyncing ? "Syncing…" : "Sync Attendance"}
              </button>
            ) : null}
            {canWrite ? (
              !isRunFinalized ? (
                <button
                  style={{ ...smallButtonStyle, opacity: isFinalizing ? 0.7 : 1 }}
                  onClick={finalizeRun}
                  disabled={isFinalizing}
                >
                  {isFinalizing ? "Finalizing…" : "Finalize Run"}
                </button>
              ) : null
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={thStyle}>Employee</th>
                  <th style={thStyle}>Payable Days (Suggested)</th>
                  <th style={thStyle}>LOP Days (Suggested)</th>
                  <th style={thStyle}>Overrides</th>
                  <th style={thStyle}>Basic</th>
                  <th style={thStyle}>HRA</th>
                  <th style={thStyle}>Allowances</th>
                  <th style={thStyle}>Deductions</th>
                  <th style={thStyle}>Gross</th>
                  <th style={thStyle}>Net Pay</th>
                  <th style={thStyle}>Payslip</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const emp = employees.find((e) => e.id === item.employee_id);
                  const net = item.net_pay ?? (item.gross ?? 0) - (item.deductions ?? 0);
                  const basic = item.salary_basic ?? item.basic;
                  const hra = item.salary_hra ?? item.hra;
                  const allowances = item.salary_allowances ?? item.allowances;
                  const status = statusMap.get(item.id);
                  const attendanceSummary = attendanceSummaryByEmployeeId[item.employee_id];
                  const hasSalaryAssignment = status?.has_salary_assignment !== false;
                  const salaryStatusCopy = getSalaryStatusCopy(status);
                  const assignLink = `/erp/hr/employees/${item.employee_id}?tab=salary`;
                  const payslip = payslipMap.get(item.employee_id);
                  const overrideDraft = overrideDrafts[item.id] || { payable: "", lop: "" };
                  const isOverrideSaving = overrideSaving[item.id];
                  return (
                    <tr key={item.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{emp?.full_name || "—"}</div>
                        <div style={{ fontSize: 12, color: "#777" }}>{emp?.employee_code || item.employee_id}</div>
                        {status?.has_salary_assignment === false ? (
                          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span style={missingBadgeStyle}>No salary assigned</span>
                            <a href={assignLink} style={assignSalaryLinkStyle}>
                              Assign salary →
                            </a>
                          </div>
                        ) : null}
                        {salaryStatusCopy ? (
                          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                            {salaryStatusCopy}
                          </div>
                        ) : null}
                        {attendanceSummary ? (
                          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                            Present: {formatDays(attendanceSummary.present_days)} · Absent:{" "}
                            {formatDays(attendanceSummary.absent_days)} · Leave:{" "}
                            {formatDays(attendanceSummary.paid_leave_days)} · OT:{" "}
                            {formatOtHours(attendanceSummary.ot_hours)}
                          </div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>{item.payable_days ?? "—"}</td>
                      <td style={tdStyle}>{item.lop_days ?? "—"}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <span style={{ fontSize: 12, color: "#6b7280" }}>Payable override</span>
                            <input
                              value={overrideDraft.payable}
                              onChange={(e) => updateOverrideDraft(item.id, "payable", e.target.value)}
                              style={smallInputStyle}
                              placeholder="e.g. 28"
                              disabled={!canWrite || isRunFinalized}
                            />
                            {overrideDraft.payable === "" ? (
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>Using suggested</span>
                            ) : null}
                          </div>
                          <div style={{ display: "grid", gap: 4 }}>
                            <span style={{ fontSize: 12, color: "#6b7280" }}>LOP override</span>
                            <input
                              value={overrideDraft.lop}
                              onChange={(e) => updateOverrideDraft(item.id, "lop", e.target.value)}
                              style={smallInputStyle}
                              placeholder="e.g. 2"
                              disabled={!canWrite || isRunFinalized}
                            />
                            {overrideDraft.lop === "" ? (
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>Using suggested</span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            style={{ ...smallButtonStyle, opacity: !canWrite || isRunFinalized || isOverrideSaving ? 0.6 : 1 }}
                            onClick={() => saveOverrides(item)}
                            disabled={!canWrite || isRunFinalized || isOverrideSaving}
                          >
                            {isOverrideSaving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </td>
                      <td style={tdStyle}>{basic ?? "—"}</td>
                      <td style={tdStyle}>{hra ?? "—"}</td>
                      <td style={tdStyle}>{allowances ?? "—"}</td>
                      <td style={tdStyle}>{item.deductions ?? "—"}</td>
                      <td style={tdStyle}>{item.gross ?? "—"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{net}</div>
                      </td>
                      <td style={tdStyle}>
                        {isRunFinalized ? (
                          payslip?.payslip_id ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ fontSize: 12, color: "#555" }}>{payslip.payslip_no || "Payslip"}</span>
                              <a href={`/erp/hr/payroll/payslips/${payslip.payslip_id}`} style={{ fontWeight: 600 }}>
                                View Payslip
                              </a>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: "#777" }}>Generating…</span>
                          )
                        ) : (
                          <span style={{ fontSize: 12, color: "#777" }}>Finalize to generate payslips</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          style={{
                            ...smallButtonStyle,
                            opacity: isRunFinalized || !hasSalaryAssignment ? 0.6 : 1,
                          }}
                          onClick={() => openOtDrawer(item)}
                          disabled={isRunFinalized || !hasSalaryAssignment}
                          title={
                            !hasSalaryAssignment
                              ? "Assign salary to enable OT and payroll calculations."
                              : "Add or edit OT"
                          }
                        >
                          OT
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Finance Posting</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
              Preview payroll journal lines for Finance.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              style={{ ...smallButtonStyle, opacity: financeLoading ? 0.7 : 1 }}
              onClick={loadFinancePreview}
              disabled={financeLoading}
            >
              {financeLoading ? "Loading…" : "Preview Finance Posting"}
            </button>
            {!financePosted && canPostFinance ? (
              <button
                style={{
                  ...buttonStyle,
                  borderColor: "#16a34a",
                  background: "#16a34a",
                  color: "#fff",
                  opacity: financePostLoading ? 0.7 : 1,
                }}
                onClick={postFinance}
                disabled={financePostLoading}
              >
                {financePostLoading ? "Posting…" : "Post to Finance"}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#374151" }}>
          {financeConfigLoading ? "Loading posting config…" : null}
          {!financeConfigLoading ? (
            hasFinanceConfig ? (
              <span style={{ color: "#047857" }}>Posting config: accounts set.</span>
            ) : (
              <span style={{ color: "#b45309" }}>Posting config: missing required accounts.</span>
            )
          ) : null}
          <span style={{ marginLeft: 10 }}>
            <a href="/erp/finance/settings/payroll-posting" style={{ color: "#2563eb", textDecoration: "none" }}>
              {canFinanceWrite ? "Edit config" : "View config"}
            </a>
          </span>
        </div>

        {financeConfigError ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>{financeConfigError}</div>
        ) : null}

        {financePostError ? (
          <div style={{ marginTop: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
            <span style={{ color: "#b91c1c", fontSize: 13 }}>{financePostError}</span>
          </div>
        ) : null}

        {financePosted ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...badgeStyle, background: "#16a34a", color: "#fff" }}>Posted</span>
              <span style={{ fontSize: 13, color: "#065f46" }}>
                Journal: {financeJournal?.doc_no || "Posted"}
              </span>
              {financeJournalLink ? (
                <a href={financeJournalLink} style={{ fontSize: 13, color: "#2563eb", textDecoration: "none" }}>
                  View journal →
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isRunFinalized ? (
          <div style={{ marginTop: 12, fontSize: 13, color: "#b45309" }}>
            Finalize payroll to enable posting previews.
          </div>
        ) : null}

        {financeError ? (
          <div style={{ marginTop: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
            <span style={{ color: "#b91c1c", fontSize: 13 }}>{financeError}</span>
          </div>
        ) : null}

        {financePreview ? (
          <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#f9fafb" }}>
              <div style={{ fontWeight: 600 }}>Preview</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                Net Pay: {formatAmount(financePreview?.totals?.net_pay)} · Earnings:{" "}
                {formatAmount(financePreview?.totals?.earnings)} · Deductions:{" "}
                {formatAmount(financePreview?.totals?.deductions)}
              </div>
              {financePreview?.errors?.length ? (
                <div style={{ marginTop: 8, padding: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#9a3412" }}>Errors</div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#9a3412" }}>
                    {financePreview.errors.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div style={{ marginTop: 8, fontSize: 12, color: financePreview?.can_post ? "#047857" : "#6b7280" }}>
                {financePreview?.can_post ? "Ready to post." : "Not ready to post."}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={thStyle}>Side</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>Amount</th>
                    <th style={thStyle}>Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {(financePreview.lines || []).map((line, index) => (
                    <tr key={`${line.side || "line"}-${line.account_id || index}`}>
                      <td style={tdStyle}>{line.side || "—"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{line.account_name || "—"}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{line.account_id || "Unassigned account"}</div>
                      </td>
                      <td style={tdStyle}>{formatAmount(line.amount)}</td>
                      <td style={tdStyle}>{line.memo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12, borderTop: "1px solid #eee", background: "#f9fafb", fontSize: 12, color: "#6b7280" }}>
              Preview totals reflect net pay. Posting will create a finance journal for this payroll run.
            </div>
          </div>
        ) : null}
      </div>

      {otOpen ? (
        <div style={overlayStyle}>
          <div style={drawerStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>Overtime</div>
                <div style={{ fontSize: 12, color: "#777" }}>{otItem?.employee_id}</div>
              </div>
              <button style={smallButtonStyle} onClick={() => setOtOpen(false)}>Close</button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <label style={labelStyle}>
                OT Type
                <select
                  value={otType}
                  onChange={(e) => applyOtLine(e.target.value, otLineMap)}
                  style={inputStyle}
                  disabled={!canWrite || isRunFinalized}
                >
                  <option value="normal">Normal OT</option>
                  <option value="holiday">Holiday OT</option>
                </select>
              </label>
              <label style={labelStyle}>
                OT Hours
                <input
                  value={otForm.units}
                  onChange={(e) => updateOtForm("units", e.target.value)}
                  placeholder="Hours"
                  style={inputStyle}
                  disabled={!canWrite || isRunFinalized}
                />
              </label>
              <label style={labelStyle}>
                OT Rate
                <input
                  value={otForm.rate}
                  onChange={(e) => updateOtForm("rate", e.target.value)}
                  placeholder="Rate"
                  style={inputStyle}
                  disabled={!canWrite || isRunFinalized}
                />
              </label>
              <label style={labelStyle}>
                OT Amount
                <input
                  value={otForm.amount}
                  onChange={(e) => updateOtForm("amount", e.target.value, false)}
                  placeholder="Amount"
                  style={inputStyle}
                  disabled={!canWrite || isRunFinalized}
                />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={otForm.notes}
                  onChange={(e) => updateOtForm("notes", e.target.value, false)}
                  placeholder="Notes"
                  style={{ ...inputStyle, minHeight: 80 }}
                  disabled={!canWrite || isRunFinalized}
                />
              </label>
            </div>

            {otLoading ? <div style={{ marginTop: 12, color: "#777" }}>Loading OT details…</div> : null}
            {otError ? <div style={{ marginTop: 12, color: "#b91c1c" }}>{otError}</div> : null}

            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <button
                style={{ ...buttonStyle, opacity: !canWrite || isRunFinalized || otSaving ? 0.7 : 1 }}
                onClick={saveOt}
                disabled={!canWrite || isRunFinalized || otSaving}
              >
                {otSaving ? "Saving…" : "Save"}
              </button>
              {!canWrite ? <div style={{ fontSize: 12, color: "#777" }}>Read-only access</div> : null}
              {isRunFinalized ? <div style={{ fontSize: 12, color: "#777" }}>Run is finalized</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getMonthStart(run) {
  if (!run?.year || !run?.month) return null;
  const year = String(run.year);
  const month = String(run.month).padStart(2, "0");
  return `${year}-${month}-01`;
}

function formatDays(value) {
  if (value === null || value === undefined) return "—";
  const fixed = Number(value).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatOtHours(hours) {
  if (hours === null || hours === undefined) return "—";
  const fixed = Number(hours).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const smallInputStyle = { padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  textTransform: "capitalize",
};
const missingBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
};
const assignSalaryLinkStyle = {
  fontSize: 12,
  color: "#2563eb",
  textDecoration: "none",
};
const statusBadgeStyles = {
  draft: { background: "#f3f4f6", color: "#374151" },
  generated: { background: "#dbeafe", color: "#1d4ed8" },
  finalized: { background: "#fee2e2", color: "#b91c1c" },
};
const attendanceBadgeStyles = {
  frozen: { background: "#ecfdf5", color: "#047857" },
  open: { background: "#fef3c7", color: "#92400e" },
  not_generated: { background: "#f3f4f6", color: "#4b5563" },
};
const thStyle = { padding: 12, borderBottom: "1px solid #eee" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 50,
};
const drawerStyle = {
  width: "min(420px, 100%)",
  background: "#fff",
  height: "100%",
  padding: 24,
  boxShadow: "-12px 0 24px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column",
};
const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#444" };
