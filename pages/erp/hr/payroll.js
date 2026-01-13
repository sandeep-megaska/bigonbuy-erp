import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function HrPayrollPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState("");
  const [items, setItems] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [lineItems, setLineItems] = useState({});
  const [lineForms, setLineForms] = useState({});
  const [lineSavingId, setLineSavingId] = useState("");
  const [lineErrors, setLineErrors] = useState({});

  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, "0"));

  const [itemEmployee, setItemEmployee] = useState("");
  const [gross, setGross] = useState("");
  const [deductions, setDeductions] = useState("");
  const [notes, setNotes] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const canWrite = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

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
      await Promise.all([
        loadRuns(context.companyId, active),
        loadEmployees(context.companyId, active),
      ]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadRuns(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_payroll_runs")
      .select("id, year, month, status, finalized_at")
      .eq("company_id", companyId)
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setRuns(data || []);
      const first = data?.[0]?.id;
      if (!selectedRun && first) {
        setSelectedRun(first);
        loadItems(companyId, first);
      }
    }
  }

  async function loadItems(companyId, runId, isActive = true) {
    if (!runId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("erp_payroll_items")
      .select("id, payroll_run_id, employee_id, gross, deductions, net_pay, notes, payslip_no, basic, hra, allowances")
      .eq("company_id", companyId)
      .eq("payroll_run_id", runId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      const list = data || [];
      setItems(list);
      setLineErrors({});
      await loadLineItems(list.map((item) => item.id), isActive);
    }
  }

  async function loadLineItems(itemIds, isActive = true) {
    if (!itemIds.length) {
      if (isActive) setLineItems({});
      return;
    }
    const requests = itemIds.map((itemId) =>
      supabase.rpc("erp_payroll_item_line_list", { p_payroll_item_id: itemId }),
    );
    const responses = await Promise.all(requests);
    const next = {};
    const nextForms = {};
    let firstError = "";
    responses.forEach((response) => {
      if (response.error && !firstError) firstError = response.error.message;
      (response.data || []).forEach((line) => {
        if (!next[line.payroll_item_id]) next[line.payroll_item_id] = [];
        next[line.payroll_item_id].push(line);
        if (line.code === "OT") {
          nextForms[line.payroll_item_id] = {
            units: line.units?.toString() || "",
            rate: line.rate?.toString() || "",
            amount: line.amount?.toString() || "",
            notes: line.notes || "",
          };
        }
      });
    });
    if (firstError) {
      if (isActive) setLineErrors((prev) => ({ ...prev, global: firstError }));
      return;
    }
    if (isActive) {
      setLineItems(next);
      setLineForms((prev) => ({ ...prev, ...nextForms }));
    }
  }

  function updateLineForm(itemId, key, value, autoAmount = true) {
    setLineForms((prev) => {
      const current = prev[itemId] || { units: "", rate: "", amount: "", notes: "" };
      const nextForm = { ...current, [key]: value };
      if (autoAmount) {
        const unitsNum = Number(nextForm.units || 0);
        const rateNum = Number(nextForm.rate || 0);
        if (Number.isFinite(unitsNum) && Number.isFinite(rateNum)) {
          nextForm.amount = (unitsNum * rateNum).toString();
        }
      }
      return { ...prev, [itemId]: nextForm };
    });
  }

  async function saveLine(itemId) {
    if (!ctx?.companyId || !itemId) return;
    if (!canWrite || isRunFinalized) return;
    setLineSavingId(itemId);
    setLineErrors((prev) => ({ ...prev, [itemId]: "" }));
    const form = lineForms[itemId] || { units: "", rate: "", amount: "", notes: "" };
    const unitsNum = form.units ? Number(form.units) : null;
    const rateNum = form.rate ? Number(form.rate) : null;
    const amountNum = form.amount ? Number(form.amount) : 0;
    const payload = {
      p_payroll_item_id: itemId,
      p_code: "OT",
      p_units: Number.isFinite(unitsNum) ? unitsNum : null,
      p_rate: Number.isFinite(rateNum) ? rateNum : null,
      p_amount: Number.isFinite(amountNum) ? amountNum : 0,
      p_notes: form.notes?.trim() || null,
    };
    const { error } = await supabase.rpc("erp_payroll_item_line_upsert", payload);
    if (error) {
      setLineErrors((prev) => ({ ...prev, [itemId]: error.message }));
      setLineSavingId("");
      return;
    }
    setLineForms((prev) => ({ ...prev, [itemId]: { units: "", rate: "", amount: "", notes: "" } }));
    await loadItems(ctx.companyId, selectedRun);
    setLineSavingId("");
  }

  async function loadEmployees(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_no")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setEmployees(data || []);
      if (!itemEmployee && data?.length) setItemEmployee(data[0].id);
    }
  }

  async function createRun(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can create payroll runs.");
      return;
    }
    const payload = {
      company_id: ctx.companyId,
      year: Number(year),
      month: Number(month),
      status: "draft",
    };
    const { data, error } = await supabase.from("erp_payroll_runs").insert(payload).select().single();
    if (error) {
      setErr(error.message);
      return;
    }
    setSelectedRun(data?.id || "");
    await loadRuns(ctx.companyId);
    if (data?.id) await loadItems(ctx.companyId, data.id);
  }

  async function createItem(e) {
    e.preventDefault();
    if (!ctx?.companyId || !selectedRun) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can add payroll items.");
      return;
    }
    if (!itemEmployee) {
      setErr("Select an employee.");
      return;
    }
    const grossNum = gross ? Number(gross) : 0;
    const deductionsNum = deductions ? Number(deductions) : 0;
    const payload = {
      company_id: ctx.companyId,
      payroll_run_id: selectedRun,
      employee_id: itemEmployee,
      gross: grossNum,
      deductions: deductionsNum,
      net_pay: grossNum - deductionsNum,
      notes: notes.trim() || null,
    };
    const { error } = await supabase.from("erp_payroll_items").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }
    setGross("");
    setDeductions("");
    setNotes("");
    await loadItems(ctx.companyId, selectedRun);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  const selectedRunObj = runs.find((r) => r.id === selectedRun);
  const isRunFinalized = selectedRunObj?.status === "finalized";
  const selectedLabel = runs.find((r) => r.id === selectedRun);
  const selectedTitle = selectedLabel ? `${selectedLabel.year}-${String(selectedLabel.month).padStart(2, "0")} (${selectedLabel.status})` : "—";

  async function finalizeRun() {
    if (!ctx?.companyId || !selectedRun) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can finalize payroll runs.");
      return;
    }
    if (isRunFinalized) {
      setErr("This payroll run is already finalized.");
      return;
    }
    setFinalizing(true);
    setErr("");
    try {
      const { data: runItems, error: itemsError } = await supabase
        .from("erp_payroll_items")
        .select("id, employee_id, payslip_no")
        .eq("company_id", ctx.companyId)
        .eq("payroll_run_id", selectedRun);
      if (itemsError) throw itemsError;

      const paddedMonth = String(selectedRunObj?.month || month).padStart(2, "0");
      const runYear = selectedRunObj?.year || year;
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
        .eq("id", selectedRun);
      if (finalizeErr) throw finalizeErr;

      await loadRuns(ctx.companyId);
      await loadItems(ctx.companyId, selectedRun);
    } catch (e) {
      setErr(e.message || "Failed to finalize payroll run.");
    } finally {
      setFinalizing(false);
    }
  }

  async function generateItems() {
    if (!ctx?.companyId || !selectedRun) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can generate payroll items.");
      return;
    }
    if (isRunFinalized) {
      setErr("This payroll run is already finalized.");
      return;
    }
    setGenerating(true);
    setErr("");
    const { error } = await supabase.rpc("erp_payroll_run_generate", { p_run_id: selectedRun });
    if (error) {
      setErr(error.message);
      setGenerating(false);
      return;
    }
    await loadItems(ctx.companyId, selectedRun);
    setGenerating(false);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading payroll…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payroll</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Payroll</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Create payroll runs and add payout items.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Create Payroll Run</h3>
        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin/hr can create/update).</div>
        ) : (
          <form onSubmit={createRun} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" style={inputStyle} />
            <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="Month" style={inputStyle} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Create Run</button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          {runs.map((run) => (
            <div key={run.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{run.year}-{String(run.month).padStart(2, "0")}</div>
                <div style={{ fontSize: 12, color: "#777" }}>{run.status} · {run.id}</div>
              </div>
              <button
                style={smallButtonStyle}
                onClick={() => {
                  setSelectedRun(run.id);
                  loadItems(ctx.companyId, run.id);
                }}
              >
                View Items
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Payroll Items for {selectedTitle}</h3>
        {!selectedRun ? (
          <div style={{ color: "#777" }}>Select or create a payroll run to add items.</div>
        ) : (
          <>
            {!canWrite ? (
              <div style={{ color: "#777", marginBottom: 8 }}>You are in read-only mode (only owner/admin/hr can create/update).</div>
            ) : isRunFinalized ? (
              <div style={{ color: "#777", marginBottom: 8 }}>This payroll run has been finalized. Items are now read-only.</div>
            ) : (
              <form onSubmit={createItem} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <select value={itemEmployee} onChange={(e) => setItemEmployee(e.target.value)} style={inputStyle}>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} {emp.employee_no ? `(${emp.employee_no})` : ""}
                    </option>
                  ))}
                </select>
                <input value={gross} onChange={(e) => setGross(e.target.value)} placeholder="Gross" style={inputStyle} />
                <input value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="Deductions" style={inputStyle} />
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" style={{ ...inputStyle, minHeight: 60 }} />
                <div style={{ gridColumn: "1 / -1" }}>
                  <button style={buttonStyle}>Add Item</button>
                </div>
              </form>
            )}

            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span>Items ({items.length})</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canWrite && selectedRun ? (
                      <button
                        style={{ ...smallButtonStyle, opacity: isRunFinalized || generating ? 0.7 : 1 }}
                        onClick={generateItems}
                        disabled={isRunFinalized || generating}
                      >
                        {generating ? "Generating…" : "Generate Items"}
                      </button>
                    ) : null}
                    {canWrite && selectedRun ? (
                      <button
                        style={{ ...smallButtonStyle, opacity: isRunFinalized || finalizing ? 0.7 : 1 }}
                        onClick={finalizeRun}
                        disabled={isRunFinalized || finalizing}
                      >
                        {isRunFinalized ? "Finalized" : finalizing ? "Finalizing…" : "Finalize Run"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={thStyle}>Employee</th>
                      <th style={thStyle}>Amounts</th>
                      <th style={thStyle}>Variable Earnings (OT)</th>
                      <th style={thStyle}>Notes & Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const emp = employees.find((e) => e.id === it.employee_id);
                      const net = it.net_pay ?? (it.gross ?? 0) - (it.deductions ?? 0);
                      const lines = lineItems[it.id] || [];
                      const otLine = lines.find((line) => line.code === "OT");
                      const isSaving = lineSavingId === it.id;
                      const currentForm = lineForms[it.id] || { units: "", rate: "", amount: "", notes: "" };
                      const rowError = lineErrors[it.id] || lineErrors.global;
                      return (
                        <tr key={it.id}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{emp?.full_name || "—"}</div>
                            <div style={{ fontSize: 12, color: "#777" }}>{emp?.employee_no || it.employee_id}</div>
                            <div style={{ fontSize: 12, color: "#777" }}>ID: {it.id}</div>
                          </td>
                          <td style={tdStyle}>
                            <div>Basic: {it.basic ?? "—"}</div>
                            <div>HRA: {it.hra ?? "—"}</div>
                            <div>Allowances: {it.allowances ?? "—"}</div>
                            <div>Gross: {it.gross ?? "—"}</div>
                            <div>Deductions: {it.deductions ?? "—"}</div>
                            <div style={{ fontWeight: 600, marginTop: 6 }}>Net (client): {net}</div>
                          </td>
                          <td style={tdStyle}>
                            {canWrite && !isRunFinalized ? (
                              <div style={{ display: "grid", gap: 8 }}>
                                <input
                                  value={currentForm.units}
                                  onChange={(e) => updateLineForm(it.id, "units", e.target.value)}
                                  placeholder="Hours"
                                  style={inputStyle}
                                />
                                <input
                                  value={currentForm.rate}
                                  onChange={(e) => updateLineForm(it.id, "rate", e.target.value)}
                                  placeholder="Rate"
                                  style={inputStyle}
                                />
                                <input
                                  value={currentForm.amount}
                                  onChange={(e) => updateLineForm(it.id, "amount", e.target.value, false)}
                                  placeholder="Amount"
                                  style={inputStyle}
                                />
                                <input
                                  value={currentForm.notes}
                                  onChange={(e) => updateLineForm(it.id, "notes", e.target.value, false)}
                                  placeholder="Notes"
                                  style={inputStyle}
                                />
                                <button
                                  type="button"
                                  style={{ ...smallButtonStyle, justifySelf: "flex-start", opacity: isSaving ? 0.7 : 1 }}
                                  onClick={() => saveLine(it.id)}
                                  disabled={isSaving}
                                >
                                  {isSaving ? "Saving…" : "Save OT"}
                                </button>
                                {rowError ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{rowError}</div> : null}
                              </div>
                            ) : (
                              <div>
                                <div>Hours: {otLine?.units ?? "—"}</div>
                                <div>Rate: {otLine?.rate ?? "—"}</div>
                                <div>Amount: {otLine?.amount ?? "—"}</div>
                                {otLine?.notes ? <div style={{ fontSize: 12, color: "#555" }}>{otLine.notes}</div> : null}
                              </div>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <div>{it.notes || "—"}</div>
                            {isRunFinalized ? (
                              <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                                Payslip: {it.payslip_no || "Generating…"}
                                <div style={{ marginTop: 6 }}>
                                  <a href={`/erp/hr/payslips/${selectedRun}/${it.employee_id}`} style={{ fontWeight: 600 }}>
                                    View Payslip
                                  </a>
                                </div>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
