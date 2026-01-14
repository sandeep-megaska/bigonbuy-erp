import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const emptyForm = {
  id: "" as string,
  code: "",
  name: "",
  is_paid: true,
  is_active: true,
  notes: "",
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type FormState = typeof emptyForm;

export default function HrLeaveTypesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const filteredLeaveTypes = useMemo(() => {
    if (!search.trim()) return leaveTypes;
    const term = search.trim().toLowerCase();
    return leaveTypes.filter((lt) =>
      [lt.code, lt.name].some((value) => value?.toLowerCase().includes(term))
    );
  }, [leaveTypes, search]);

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
      .select("id, code, name, is_paid, is_active, notes, created_at")
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setLeaveTypes((data as LeaveType[]) || []);
  }

  function openModal(row?: LeaveType) {
    setForm({
      id: row?.id || "",
      code: row?.code || "",
      name: row?.name || "",
      is_paid: row?.is_paid ?? true,
      is_active: row?.is_active ?? true,
      notes: row?.notes || "",
    });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setForm({ ...emptyForm });
    setFormError("");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canManage) {
      setFormError("Only HR/admin/payroll can manage leave types.");
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const { data, error } = await supabase.rpc("erp_leave_type_upsert", {
      p_id: form.id || null,
      p_code: form.code.trim(),
      p_name: form.name.trim(),
      p_is_paid: form.is_paid,
      p_is_active: form.is_active,
      p_notes: form.notes.trim() || null,
    });

    if (error) {
      setFormError(error.message || "Unable to save leave type.");
      setSaving(false);
      return;
    }

    setToast({
      type: "success",
      message: `Leave type ${form.id ? "updated" : "created"} successfully.`,
    });
    setSaving(false);
    closeModal();
    if (data) {
      await loadLeaveTypes();
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading leave types…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Leave Types</h1>
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
          <p style={eyebrowStyle}>HR · Leave</p>
          <h1 style={titleStyle}>Leave Types</h1>
          <p style={subtitleStyle}>Create and maintain leave types for your company.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr" style={linkStyle}>← Back to HR Home</a>
          <button type="button" onClick={() => openModal()} style={primaryButtonStyle}>
            Add Leave Type
          </button>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={toolbarStyle}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or name"
            style={searchInputStyle}
          />
          <span style={{ color: "#6b7280" }}>Total: {filteredLeaveTypes.length}</span>
        </div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Notes</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeaveTypes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>
                    No leave types found.
                  </td>
                </tr>
              ) : (
                filteredLeaveTypes.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.code}</td>
                    <td style={tdStyle}>{row.name}</td>
                    <td style={tdStyle}>{row.is_paid ? "Paid" : "Unpaid"}</td>
                    <td style={tdStyle}>{row.is_active ? "Active" : "Inactive"}</td>
                    <td style={tdStyle}>{row.notes || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button type="button" onClick={() => openModal(row)} style={smallButtonStyle}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>{form.id ? "Edit" : "Add"} Leave Type</h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Configure paid/unpaid leave and availability.
                </p>
              </div>
              <button type="button" onClick={closeModal} style={buttonStyle}>Close</button>
            </div>
            <form onSubmit={handleSave} style={formGridStyle}>
              <label style={labelStyle}>
                Code *
                <input
                  value={form.code}
                  onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                  placeholder="e.g., CL"
                  style={inputStyle}
                  required
                />
              </label>
              <label style={labelStyle}>
                Name *
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Casual Leave"
                  style={inputStyle}
                  required
                />
              </label>
              <label style={labelStyle}>
                Paid Leave
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.is_paid}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_paid: e.target.checked }))}
                  />
                  <span style={{ color: "#4b5563" }}>This leave is paid</span>
                </div>
              </label>
              <label style={labelStyle}>
                Active
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  />
                  <span style={{ color: "#4b5563" }}>Available for requests</span>
                </div>
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes"
                  style={textareaStyle}
                  rows={3}
                />
              </label>
              {formError ? <div style={errorBoxStyle}>{formError}</div> : null}
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={closeModal} style={buttonStyle}>Cancel</button>
                <button type="submit" style={primaryButtonStyle} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
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

const searchInputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  minWidth: 220,
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
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
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

const smallButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 40,
};

const modalCardStyle: CSSProperties = {
  width: "min(720px, 100%)",
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 600,
  color: "#111827",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
};

const textareaStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  resize: "vertical",
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
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
