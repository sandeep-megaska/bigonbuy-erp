import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

const getMonthStartDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
};

const getEmptyStructureForm = () => ({
  name: "",
  notes: "",
  isActive: true,
  basicPct: "50",
  hraPctOfBasic: "40",
  allowancesMode: "remainder",
  effectiveFrom: getMonthStartDate(),
});
const emptyComponentForm = {
  code: "",
  name: "",
  componentType: "earning",
  calcMode: "fixed",
  value: "",
  isActive: true,
};
const emptyOtRules = {
  normal: { multiplier: "", base: "basic_hourly", hoursPerDay: "8", isActive: true },
  holiday: { multiplier: "", base: "basic_hourly", hoursPerDay: "8", isActive: true },
};

export default function HrSalaryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);

  const [structures, setStructures] = useState([]);
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [structureForm, setStructureForm] = useState(getEmptyStructureForm);

  const [components, setComponents] = useState([]);
  const [componentForm, setComponentForm] = useState(emptyComponentForm);

  const [otRules, setOtRules] = useState(emptyOtRules);

  const roleKey = ctx?.roleKey ?? "";
  const canWrite = useMemo(
    () => ["owner", "admin", "hr", "payroll"].includes(roleKey),
    [roleKey]
  );

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

      await loadStructures(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !selectedStructureId) return;
    loadComponents(ctx.companyId, selectedStructureId);
    loadOtRules(ctx.companyId, selectedStructureId);
  }, [ctx?.companyId, selectedStructureId]);

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function loadStructures(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_salary_structures")
      .select("id, name, notes, is_active, basic_pct, hra_pct_of_basic, allowances_mode, effective_from")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setStructures(data || []);
      if (!selectedStructureId && data?.length) {
        const first = data[0];
        setSelectedStructureId(first.id);
        setStructureForm({
          name: first.name ?? "",
          notes: first.notes ?? "",
          isActive: first.is_active ?? true,
          basicPct: first.basic_pct?.toString() ?? "50",
          hraPctOfBasic: first.hra_pct_of_basic?.toString() ?? "40",
          allowancesMode: first.allowances_mode ?? "remainder",
          effectiveFrom: first.effective_from ? first.effective_from.split("T")[0] : getMonthStartDate(),
        });
      }
    }
  }

  async function loadComponents(companyId, structureId) {
    const { data, error } = await supabase
      .from("erp_salary_structure_components")
      .select("id, code, name, component_type, calc_mode, value, is_active")
      .eq("company_id", companyId)
      .eq("structure_id", structureId)
      .order("code", { ascending: true });
    if (error) {
      setErr(error.message);
      return;
    }
    setComponents(data || []);
  }

  async function loadOtRules(companyId, structureId) {
    const { data, error } = await supabase
      .from("erp_salary_structure_ot_rules")
      .select("ot_type, multiplier, base, hours_per_day, is_active")
      .eq("company_id", companyId)
      .eq("structure_id", structureId);
    if (error) {
      setErr(error.message);
      return;
    }
    const next = { ...emptyOtRules };
    (data || []).forEach((rule) => {
      if (rule.ot_type === "normal" || rule.ot_type === "holiday") {
        next[rule.ot_type] = {
          multiplier: rule.multiplier?.toString() ?? "",
          base: rule.base ?? "basic_hourly",
          hoursPerDay: rule.hours_per_day?.toString() ?? "8",
          isActive: rule.is_active ?? true,
        };
      }
    });
    setOtRules(next);
  }

  async function handleStructureSave(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/payroll can manage salary structures.");
      return;
    }

    const payload = {
      p_name: structureForm.name.trim(),
      p_is_active: structureForm.isActive,
      p_notes: structureForm.notes.trim() || null,
      p_basic_pct: structureForm.basicPct ? Number(structureForm.basicPct) : 50,
      p_hra_pct_of_basic: structureForm.hraPctOfBasic ? Number(structureForm.hraPctOfBasic) : 40,
      p_allowances_mode: structureForm.allowancesMode || "remainder",
      p_effective_from: structureForm.effectiveFrom || getMonthStartDate(),
      p_id: selectedStructureId || null,
    };

    const { data, error } = await supabase.rpc("erp_salary_structure_upsert", payload);
    if (error) {
      setErr(error.message);
      return;
    }

    const newId = data;
    await loadStructures(ctx.companyId);
    setSelectedStructureId(newId);
    showToast(selectedStructureId ? "Salary structure updated" : "Salary structure created");
  }

  async function handleNewStructure() {
    setSelectedStructureId("");
    setStructureForm(getEmptyStructureForm());
    setComponents([]);
    setOtRules(emptyOtRules);
  }

  async function handleAddComponent(e) {
    e.preventDefault();
    if (!ctx?.companyId || !selectedStructureId) return;
    if (!canWrite) {
      setErr("Only HR/admin/payroll can manage components.");
      return;
    }

    const payload = {
      p_structure_id: selectedStructureId,
      p_code: componentForm.code.trim(),
      p_name: componentForm.name.trim(),
      p_component_type: componentForm.componentType,
      p_calc_mode: componentForm.calcMode,
      p_value: componentForm.value ? Number(componentForm.value) : null,
      p_is_active: componentForm.isActive,
    };

    const { error } = await supabase.rpc("erp_salary_structure_component_upsert", payload);
    if (error) {
      setErr(error.message);
      return;
    }

    setComponentForm(emptyComponentForm);
    await loadComponents(ctx.companyId, selectedStructureId);
    showToast("Component saved");
  }

  async function handleSaveOtRule(type) {
    if (!ctx?.companyId || !selectedStructureId) return;
    if (!canWrite) {
      setErr("Only HR/admin/payroll can manage OT rules.");
      return;
    }

    const rule = otRules[type];
    const payload = {
      p_structure_id: selectedStructureId,
      p_ot_type: type,
      p_multiplier: Number(rule.multiplier || 0),
      p_base: rule.base,
      p_is_active: rule.isActive,
      p_hours_per_day: rule.hoursPerDay ? Number(rule.hoursPerDay) : 8,
    };

    const { error } = await supabase.rpc("erp_salary_structure_ot_rule_upsert", payload);
    if (error) {
      setErr(error.message);
      return;
    }

    showToast("OT rule saved");
  }

  async function handleSelectStructure(id) {
    setSelectedStructureId(id);
    const structure = structures.find((item) => item.id === id);
    if (structure) {
      setStructureForm({
        name: structure.name ?? "",
        notes: structure.notes ?? "",
        isActive: structure.is_active ?? true,
        basicPct: structure.basic_pct?.toString() ?? "50",
        hraPctOfBasic: structure.hra_pct_of_basic?.toString() ?? "40",
        allowancesMode: structure.allowances_mode ?? "remainder",
        effectiveFrom: structure.effective_from ? structure.effective_from.split("T")[0] : getMonthStartDate(),
      });
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading salary structures…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Salary Structures</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Salary Structures</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Define salary structures, components, and OT rules.</p>
          <p style={{ marginTop: 4, color: "#6b7280", fontSize: 13 }}>
            CTC is assigned per employee (Employee → Salary tab).
          </p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

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

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(220px, 260px) 1fr", gap: 18 }}>
        <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Structures</h3>
            {canWrite ? (
              <button style={smallButtonStyle} onClick={handleNewStructure}>New</button>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {structures.map((structure) => (
              <button
                key={structure.id}
                type="button"
                onClick={() => handleSelectStructure(structure.id)}
                style={{
                  ...structureButtonStyle,
                  ...(structure.id === selectedStructureId ? structureButtonActiveStyle : null),
                }}
              >
                <div style={{ fontWeight: 600 }}>{structure.name}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {structure.is_active ? "Active" : "Inactive"}
                </div>
              </button>
            ))}
            {!structures.length ? <div style={{ color: "#777", fontSize: 13 }}>No structures yet.</div> : null}
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Structure Details</h3>
              {!canWrite ? <span style={{ fontSize: 12, color: "#777" }}>Read-only</span> : null}
            </div>
            <form onSubmit={handleStructureSave} style={{ display: "grid", gap: 12 }}>
              <label style={labelStyle}>
                Name
                <input
                  value={structureForm.name}
                  onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })}
                  style={inputStyle}
                  placeholder="Structure name"
                  disabled={!canWrite}
                />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={structureForm.notes}
                  onChange={(e) => setStructureForm({ ...structureForm, notes: e.target.value })}
                  style={{ ...inputStyle, minHeight: 80 }}
                  placeholder="Optional notes"
                  disabled={!canWrite}
                />
              </label>
              <label style={labelStyle}>
                Effective From
                <input
                  type="date"
                  value={structureForm.effectiveFrom}
                  onChange={(e) => setStructureForm({ ...structureForm, effectiveFrom: e.target.value })}
                  style={inputStyle}
                  required
                  disabled={!canWrite}
                />
              </label>
              <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={structureForm.isActive}
                  onChange={(e) => setStructureForm({ ...structureForm, isActive: e.target.checked })}
                  disabled={!canWrite}
                />
                Active
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <label style={labelStyle}>
                  Basic % of CTC
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={structureForm.basicPct}
                    onChange={(e) => setStructureForm({ ...structureForm, basicPct: e.target.value })}
                    style={inputStyle}
                    disabled={!canWrite}
                  />
                </label>
                <label style={labelStyle}>
                  HRA % of Basic
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={structureForm.hraPctOfBasic}
                    onChange={(e) => setStructureForm({ ...structureForm, hraPctOfBasic: e.target.value })}
                    style={inputStyle}
                    disabled={!canWrite}
                  />
                </label>
                <label style={labelStyle}>
                  Allowances Mode
                  <input
                    value={structureForm.allowancesMode}
                    style={inputStyle}
                    readOnly
                    disabled
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={buttonStyle} disabled={!canWrite || !structureForm.name.trim()}>
                  {selectedStructureId ? "Save Changes" : "Create Structure"}
                </button>
              </div>
            </form>
          </div>

          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Components</h3>
            {!selectedStructureId ? (
              <div style={{ color: "#777" }}>Select a structure to manage components.</div>
            ) : (
              <>
                {canWrite ? (
                  <form onSubmit={handleAddComponent} style={{ display: "grid", gap: 10, marginBottom: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                      <input
                        value={componentForm.code}
                        onChange={(e) => setComponentForm({ ...componentForm, code: e.target.value })}
                        placeholder="Code (e.g., BASIC)"
                        style={inputStyle}
                      />
                      <input
                        value={componentForm.name}
                        onChange={(e) => setComponentForm({ ...componentForm, name: e.target.value })}
                        placeholder="Name"
                        style={inputStyle}
                      />
                      <select
                        value={componentForm.componentType}
                        onChange={(e) => setComponentForm({ ...componentForm, componentType: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="earning">Earning</option>
                        <option value="deduction">Deduction</option>
                      </select>
                      <select
                        value={componentForm.calcMode}
                        onChange={(e) => setComponentForm({ ...componentForm, calcMode: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="fixed">Fixed</option>
                        <option value="percent_of_basic">% of Basic</option>
                        <option value="manual">Manual</option>
                      </select>
                      <input
                        value={componentForm.value}
                        onChange={(e) => setComponentForm({ ...componentForm, value: e.target.value })}
                        placeholder="Value"
                        style={inputStyle}
                      />
                    </div>
                    <button style={buttonStyle} disabled={!componentForm.code.trim() || !componentForm.name.trim()}>
                      Save Component
                    </button>
                  </form>
                ) : (
                  <div style={{ color: "#777", marginBottom: 12 }}>Read-only access for components.</div>
                )}

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Code</th>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Type</th>
                        <th style={thStyle}>Calc</th>
                        <th style={thStyle}>Value</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((row) => (
                        <tr key={row.id}>
                          <td style={tdStyle}>{row.code}</td>
                          <td style={tdStyle}>{row.name}</td>
                          <td style={tdStyle}>{row.component_type}</td>
                          <td style={tdStyle}>{row.calc_mode}</td>
                          <td style={tdStyle}>{row.value ?? "—"}</td>
                          <td style={tdStyle}>{row.is_active ? "Active" : "Inactive"}</td>
                        </tr>
                      ))}
                      {!components.length ? (
                        <tr>
                          <td style={tdStyle} colSpan={6}>
                            <div style={{ color: "#777" }}>No components defined yet.</div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>OT Rules</h3>
            {!selectedStructureId ? (
              <div style={{ color: "#777" }}>Select a structure to manage OT rules.</div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {["normal", "holiday"].map((type) => {
                  const rule = otRules[type];
                  return (
                    <div key={type} style={{ padding: 12, border: "1px solid #f0f0f0", borderRadius: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>{type === "normal" ? "Normal OT" : "Holiday OT"}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                        <label style={labelStyle}>
                          Multiplier
                          <input
                            value={rule.multiplier}
                            onChange={(e) => setOtRules({
                              ...otRules,
                              [type]: { ...rule, multiplier: e.target.value },
                            })}
                            placeholder="e.g., 1.25"
                            style={inputStyle}
                            disabled={!canWrite}
                          />
                        </label>
                        <label style={labelStyle}>
                          Base
                          <select
                            value={rule.base}
                            onChange={(e) => setOtRules({
                              ...otRules,
                              [type]: { ...rule, base: e.target.value },
                            })}
                            style={inputStyle}
                            disabled={!canWrite}
                          >
                            <option value="basic_hourly">Basic hourly</option>
                            <option value="gross_hourly">Gross hourly</option>
                          </select>
                        </label>
                        <label style={labelStyle}>
                          Hours per day
                          <input
                            value={rule.hoursPerDay}
                            onChange={(e) => setOtRules({
                              ...otRules,
                              [type]: { ...rule, hoursPerDay: e.target.value },
                            })}
                            placeholder="8"
                            style={inputStyle}
                            disabled={!canWrite}
                          />
                        </label>
                        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={rule.isActive}
                            onChange={(e) => setOtRules({
                              ...otRules,
                              [type]: { ...rule, isActive: e.target.checked },
                            })}
                            disabled={!canWrite}
                          />
                          Active
                        </label>
                      </div>
                      <button
                        style={{ ...buttonStyle, marginTop: 10 }}
                        onClick={() => handleSaveOtRule(type)}
                        disabled={!canWrite || !rule.multiplier}
                      >
                        Save {type === "normal" ? "Normal" : "Holiday"} Rule
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee", textAlign: "left" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#444" };
const structureButtonStyle = {
  width: "100%",
  textAlign: "left",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  cursor: "pointer",
};
const structureButtonActiveStyle = {
  borderColor: "#6366f1",
  background: "#eef2ff",
  color: "#312e81",
};
