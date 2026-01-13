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
  const [toast, setToast] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [otOpen, setOtOpen] = useState(false);
  const [otLoading, setOtLoading] = useState(false);
  const [otSaving, setOtSaving] = useState(false);
  const [otError, setOtError] = useState("");
  const [otItem, setOtItem] = useState(null);
  const [otForm, setOtForm] = useState(emptyOtForm);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "hr", "payroll"].includes(ctx.roleKey);
  }, [ctx]);

  const isRunFinalized = run?.status === "finalized";

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
      const [{ data: runData, error: runErr }, { data: itemsData, error: itemsErr }, { data: employeesData, error: employeesErr }] =
        await Promise.all([
          supabase
            .from("erp_payroll_runs")
            .select("id, year, month, status, finalized_at")
            .eq("company_id", companyId)
            .eq("id", runId)
            .maybeSingle(),
          supabase
            .from("erp_payroll_items")
            .select("id, employee_id, gross, deductions, net_pay, notes, payslip_no, basic, hra, allowances")
            .eq("company_id", companyId)
            .eq("payroll_run_id", runId)
            .order("created_at", { ascending: false }),
          supabase
            .from("erp_employees")
            .select("id, full_name, employee_no")
            .eq("company_id", companyId)
            .order("full_name", { ascending: true }),
        ]);

      if (!active) return;

      if (runErr || itemsErr || employeesErr) {
        setErr(runErr?.message || itemsErr?.message || employeesErr?.message || "Unable to load payroll run.");
        return;
      }

      setRun(runData);
      setItems(itemsData || []);
      setEmployees(employeesData || []);
    })();
    return () => {
      active = false;
    };
  }, [ctx, runId]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function getAuthHeaders() {
    const token = ctx?.session?.access_token;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
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

  async function openOtDrawer(item) {
    setOtItem(item);
    setOtForm(emptyOtForm);
    setOtError("");
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
      const otLine = (payload.lines || []).find((line) => line.code === "OT");
      setOtForm({
        units: otLine?.units?.toString() || "",
        rate: otLine?.rate?.toString() || "",
        amount: otLine?.amount?.toString() || "",
        notes: otLine?.notes || "",
      });
    } catch (e) {
      setOtError(e.message || "Failed to load OT line");
    } finally {
      setOtLoading(false);
    }
  }

  async function saveOt() {
    if (!otItem?.id) return;
    if (!canWrite || isRunFinalized) return;
    setOtSaving(true);
    setOtError("");
    try {
      const response = await fetch("/api/erp/payroll/item-lines/upsert", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          payrollItemId: otItem.id,
          code: "OT",
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
      setToast("OT saved");
      setTimeout(() => setToast(""), 2500);
      setOtOpen(false);
    } catch (e) {
      setOtError(e.message || "Failed to save OT");
    } finally {
      setOtSaving(false);
    }
  }

  async function refreshItems() {
    if (!ctx?.companyId || !runId) return;
    const { data, error } = await supabase
      .from("erp_payroll_items")
      .select("id, employee_id, gross, deductions, net_pay, notes, payslip_no, basic, hra, allowances")
      .eq("company_id", ctx.companyId)
      .eq("payroll_run_id", runId)
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      return;
    }
    setItems(data || []);
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
    const { error } = await supabase.rpc("erp_payroll_run_generate", { p_run_id: runId });
    if (error) {
      setErr(error.message);
      setIsGenerating(false);
      return;
    }
    await refreshItems();
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
    setIsFinalizing(true);
    setErr("");
    try {
      const { data: runItems, error: itemsError } = await supabase
        .from("erp_payroll_items")
        .select("id, employee_id, payslip_no")
        .eq("company_id", ctx.companyId)
        .eq("payroll_run_id", runId);
      if (itemsError) throw itemsError;

      const paddedMonth = String(run?.month || "").padStart(2, "0");
      const runYear = run?.year;
      const updates = [];
      (runItems || []).forEach((item) => {
        if (!item.payslip_no) {
          const emp = employees.find((e) => e.id === item.employee_id);
          const empCode = emp?.employee_no || item.employee_id;
          updates.push({
            id: item.id,
            payslip_no: `BB-${runYear}${paddedMonth}-${empCode}`,
          });
        }
      });

      for (const update of updates) {
        const { error: updErr } = await supabase
          .from("erp_payroll_items")
          .update({ payslip_no: update.payslip_no })
          .eq("company_id", ctx.companyId)
          .eq("id", update.id);
        if (updErr) throw updErr;
      }

      const { error: finalizeErr } = await supabase
        .from("erp_payroll_runs")
        .update({
          status: "finalized",
          finalized_at: new Date().toISOString(),
          finalized_by: ctx.userId,
        })
        .eq("company_id", ctx.companyId)
        .eq("id", runId);
      if (finalizeErr) throw finalizeErr;

      const { data: runData, error: runErr } = await supabase
        .from("erp_payroll_runs")
        .select("id, year, month, status, finalized_at")
        .eq("company_id", ctx.companyId)
        .eq("id", runId)
        .maybeSingle();
      if (runErr) throw runErr;
      setRun(runData);
      await refreshItems();
    } catch (e) {
      setErr(e.message || "Failed to finalize payroll run.");
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
          <h1 style={{ margin: 0 }}>Payroll Run</h1>
          <p style={{ marginTop: 6, color: "#555" }}>
            {run.year}-{String(run.month).padStart(2, "0")} · {run.status}
          </p>
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
        <div style={{ marginTop: 12, padding: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, color: "#047857" }}>
          {toast}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Payroll Items ({items.length})</h3>
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
                style={{ ...smallButtonStyle, opacity: isRunFinalized || isFinalizing ? 0.7 : 1 }}
                onClick={finalizeRun}
                disabled={isRunFinalized || isFinalizing}
              >
                {isRunFinalized ? "Finalized" : isFinalizing ? "Finalizing…" : "Finalize Run"}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={thStyle}>Employee</th>
                  <th style={thStyle}>Gross</th>
                  <th style={thStyle}>Deductions</th>
                  <th style={thStyle}>Net Pay</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const emp = employees.find((e) => e.id === item.employee_id);
                  const net = item.net_pay ?? (item.gross ?? 0) - (item.deductions ?? 0);
                  return (
                    <tr key={item.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{emp?.full_name || "—"}</div>
                        <div style={{ fontSize: 12, color: "#777" }}>{emp?.employee_no || item.employee_id}</div>
                      </td>
                      <td style={tdStyle}>{item.gross ?? "—"}</td>
                      <td style={tdStyle}>{item.deductions ?? "—"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{net}</div>
                        {isRunFinalized ? (
                          <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                            Payslip: {item.payslip_no || "Generating…"}
                            <div style={{ marginTop: 6 }}>
                              <a href={`/erp/hr/payslips/${runId}/${item.employee_id}`} style={{ fontWeight: 600 }}>
                                View Payslip
                              </a>
                            </div>
                          </div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          style={smallButtonStyle}
                          onClick={() => openOtDrawer(item)}
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
                OT Hours
                <input
                  value={otForm.units}
                  onChange={(e) => updateOtForm("units", e.target.value)}
                  placeholder="Hours"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                OT Rate
                <input
                  value={otForm.rate}
                  onChange={(e) => updateOtForm("rate", e.target.value)}
                  placeholder="Rate"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                OT Amount
                <input
                  value={otForm.amount}
                  onChange={(e) => updateOtForm("amount", e.target.value, false)}
                  placeholder="Amount"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={otForm.notes}
                  onChange={(e) => updateOtForm("notes", e.target.value, false)}
                  placeholder="Notes"
                  style={{ ...inputStyle, minHeight: 80 }}
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

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
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
