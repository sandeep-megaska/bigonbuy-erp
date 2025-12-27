import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function HrSalaryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [employees, setEmployees] = useState([]);
  const [structures, setStructures] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ctcMonthly, setCtcMonthly] = useState("");
  const [basic, setBasic] = useState("");
  const [hra, setHra] = useState("");
  const [allowances, setAllowances] = useState("");
  const [deductions, setDeductions] = useState("");
  const [notes, setNotes] = useState("");

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

      await loadEmployees(context.companyId, active);
      await loadStructures(context.companyId, selectedEmployee || undefined, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (ctx?.companyId && selectedEmployee) {
      loadStructures(ctx.companyId, selectedEmployee);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployee]);

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
      if (!selectedEmployee && data?.length) setSelectedEmployee(data[0].id);
    }
  }

  async function loadStructures(companyId, employeeId, isActive = true) {
    if (!employeeId && isActive) {
      setStructures([]);
      return;
    }
    const { data, error } = await supabase
      .from("erp_salary_structures")
      .select("id, employee_id, effective_from, ctc_monthly, basic, hra, allowances, deductions, notes")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId || selectedEmployee)
      .order("effective_from", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setStructures(data || []);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can create salary structures.");
      return;
    }
    if (!selectedEmployee) {
      setErr("Select an employee first.");
      return;
    }

    const payload = {
      company_id: ctx.companyId,
      employee_id: selectedEmployee,
      effective_from: effectiveFrom || null,
      ctc_monthly: ctcMonthly ? Number(ctcMonthly) : null,
      basic: basic ? Number(basic) : null,
      hra: hra ? Number(hra) : null,
      allowances: allowances ? Number(allowances) : null,
      deductions: deductions ? Number(deductions) : null,
      notes: notes.trim() || null,
    };
    const { error } = await supabase.from("erp_salary_structures").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }

    setEffectiveFrom("");
    setCtcMonthly("");
    setBasic("");
    setHra("");
    setAllowances("");
    setDeductions("");
    setNotes("");
    await loadStructures(ctx.companyId, selectedEmployee);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  const selectedName = employees.find((e) => e.id === selectedEmployee)?.full_name || "—";

  if (loading) return <div style={{ padding: 24 }}>Loading salary…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Salary</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Salary</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Maintain salary structures per employee.</p>
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
        <h3 style={{ marginTop: 0 }}>Select Employee</h3>
        <select
          value={selectedEmployee}
          onChange={(e) => {
            setSelectedEmployee(e.target.value);
            loadStructures(ctx.companyId, e.target.value);
          }}
          style={{ ...inputStyle, maxWidth: 360 }}
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name} {emp.employee_no ? `(${emp.employee_no})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Add Salary Structure for {selectedName}</h3>

        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin/hr can create/update).</div>
        ) : (
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} placeholder="Effective From" style={inputStyle} />
            <input value={ctcMonthly} onChange={(e) => setCtcMonthly(e.target.value)} placeholder="CTC Monthly" style={inputStyle} />
            <input value={basic} onChange={(e) => setBasic(e.target.value)} placeholder="Basic" style={inputStyle} />
            <input value={hra} onChange={(e) => setHra(e.target.value)} placeholder="HRA" style={inputStyle} />
            <input value={allowances} onChange={(e) => setAllowances(e.target.value)} placeholder="Allowances" style={inputStyle} />
            <input value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="Deductions" style={inputStyle} />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" style={{ ...inputStyle, minHeight: 80 }} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Add Structure</button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Salary Structures ({structures.length}) for {selectedName}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Effective From</th>
                <th style={thStyle}>CTC (Monthly)</th>
                <th style={thStyle}>Components</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((row) => {
                const gross = (row.basic ?? 0) + (row.hra ?? 0) + (row.allowances ?? 0);
                const deductionsVal = row.deductions ?? 0;
                const net = gross - deductionsVal;
                return (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{row.effective_from ? new Date(row.effective_from).toLocaleDateString() : "—"}</div>
                      <div style={{ fontSize: 12, color: "#777" }}>{row.id}</div>
                    </td>
                    <td style={tdStyle}>{row.ctc_monthly ?? "—"}</td>
                    <td style={tdStyle}>
                      <div>Basic: {row.basic ?? "—"}</div>
                      <div>HRA: {row.hra ?? "—"}</div>
                      <div>Allowances: {row.allowances ?? "—"}</div>
                      <div>Deductions: {row.deductions ?? "—"}</div>
                      <div style={{ marginTop: 6, fontWeight: 600 }}>Net (client): {net}</div>
                    </td>
                    <td style={tdStyle}>{row.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
