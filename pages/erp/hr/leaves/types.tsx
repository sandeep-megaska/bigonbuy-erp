import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const buttonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
  width: "100%",
};

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };

const statusBadge = (active: boolean): React.CSSProperties => ({
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 12,
  background: active ? "#ecfdf3" : "#fef2f2",
  color: active ? "#047857" : "#b91c1c",
  border: `1px solid ${active ? "#a7f3d0" : "#fecaca"}`,
});

const toastStyle = (type: "success" | "error"): React.CSSProperties => ({
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${type === "success" ? "#a7f3d0" : "#fecaca"}`,
  background: type === "success" ? "#ecfdf5" : "#fef2f2",
  color: type === "success" ? "#047857" : "#b91c1c",
  marginBottom: 12,
});

const toggleButtonStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 13,
};

const pageWrapper: React.CSSProperties = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1200,
  margin: "0 auto",
};

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const listTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
};

const checkboxRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginTop: 8 };

const emptyText: React.CSSProperties = { color: "#6b7280", fontStyle: "italic" };

const initialForm = {
  id: "",
  code: "",
  name: "",
  is_paid: true,
  accrual_policy: "",
  is_active: true,
  notes: "",
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  accrual_policy: string | null;
  is_active: boolean;
  notes: string | null;
};

export default function LeaveTypesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined as string | undefined });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);

  const canManage = useMemo(() => isHr(ctx?.roleKey), [ctx?.roleKey]);

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
      await loadLeaveTypes();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_leave_types")
      .select("id, code, name, is_paid, accrual_policy, is_active, notes")
      .order("name", { ascending: true });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setLeaveTypes(data || []);
  }

  function resetForm() {
    setForm(initialForm);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setToast(null);
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/Admin can manage leave types." });
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setToast({ type: "error", message: "Code and name are required." });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("erp_leave_type_upsert", {
      p_id: form.id || null,
      p_code: form.code.trim(),
      p_name: form.name.trim(),
      p_is_paid: form.is_paid,
      p_is_active: form.is_active,
      p_notes: form.notes?.trim() || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return;
    }

    const { error: accrualError } = await supabase
      .from("erp_leave_types")
      .update({ accrual_policy: form.accrual_policy.trim() || null })
      .eq("id", data);
    if (accrualError) {
      setToast({ type: "error", message: accrualError.message });
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Leave type saved." });
    resetForm();
    await loadLeaveTypes();
    setSaving(false);
  }

  async function handleToggleActive(leaveType: LeaveType) {
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/Admin can manage leave types." });
      return;
    }
    const { error } = await supabase.rpc("erp_leave_type_upsert", {
      p_id: leaveType.id,
      p_code: leaveType.code,
      p_name: leaveType.name,
      p_is_paid: leaveType.is_paid,
      p_is_active: !leaveType.is_active,
      p_notes: leaveType.notes,
    });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    await loadLeaveTypes();
  }

  if (loading) {
    return <div style={pageWrapper}>Loading leave types…</div>;
  }

  return (
    <div style={pageWrapper}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Leave Types</h1>
          <p style={{ marginTop: 6, color: "#4b5563" }}>
            Manage paid/unpaid leave configurations.
          </p>
        </div>
        <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← HR Home</a>
      </div>

      {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

      <div style={{ display: "grid", gap: 16 }}>
        <form onSubmit={handleSave} style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>{form.id ? "Edit Leave Type" : "New Leave Type"}</h3>
          <div style={formGrid}>
            <label style={labelStyle}>
              Code
              <input
                style={inputStyle}
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="AL"
              />
            </label>
            <label style={labelStyle}>
              Name
              <input
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Annual Leave"
              />
            </label>
            <label style={labelStyle}>
              Accrual Policy
              <input
                style={inputStyle}
                value={form.accrual_policy}
                onChange={(e) => setForm((prev) => ({ ...prev, accrual_policy: e.target.value }))}
                placeholder="e.g. 1.5 days/month"
              />
            </label>
            <label style={labelStyle}>
              Notes
              <input
                style={inputStyle}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional"
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={form.is_paid}
                onChange={(e) => setForm((prev) => ({ ...prev, is_paid: e.target.checked }))}
              />
              Paid leave
            </label>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
            <button type="submit" style={buttonStyle} disabled={saving}>
              {saving ? "Saving…" : "Save Leave Type"}
            </button>
            {form.id ? (
              <button type="button" style={toggleButtonStyle} onClick={resetForm}>
                Cancel Edit
              </button>
            ) : null}
          </div>
        </form>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Existing Leave Types</h3>
          {leaveTypes.length === 0 ? (
            <p style={emptyText}>No leave types yet.</p>
          ) : (
            <table style={listTable}>
              <thead>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Paid</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaveTypes.map((type) => (
                  <tr key={type.id}>
                    <td style={tdStyle}>{type.code}</td>
                    <td style={tdStyle}>
                      <strong>{type.name}</strong>
                      {type.accrual_policy ? (
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{type.accrual_policy}</div>
                      ) : null}
                    </td>
                    <td style={tdStyle}>{type.is_paid ? "Paid" : "Unpaid"}</td>
                    <td style={tdStyle}><span style={statusBadge(type.is_active)}>{type.is_active ? "Active" : "Inactive"}</span></td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          style={toggleButtonStyle}
                          onClick={() =>
                            setForm({
                              id: type.id,
                              code: type.code,
                              name: type.name,
                              is_paid: type.is_paid,
                              accrual_policy: type.accrual_policy || "",
                              is_active: type.is_active,
                              notes: type.notes || "",
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          style={toggleButtonStyle}
                          onClick={() => handleToggleActive(type)}
                        >
                          {type.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
