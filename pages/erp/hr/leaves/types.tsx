import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const emptyForm = {
  id: "" as string,
  key: "",
  name: "",
  is_paid: true,
  is_active: true,
  allows_half_day: false,
  requires_approval: true,
  counts_weekly_off: false,
  counts_holiday: false,
  display_order: 100,
};

type LeaveType = {
  id: string;
  key: string;
  name: string;
  is_paid: boolean;
  is_active: boolean;
  allows_half_day: boolean;
  requires_approval: boolean;
  counts_weekly_off: boolean;
  counts_holiday: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
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
      [lt.key, lt.name].some((value) => value?.toLowerCase().includes(term))
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
      .from("erp_hr_leave_types")
      .select(
        "id, key, name, is_paid, is_active, allows_half_day, requires_approval, counts_weekly_off, counts_holiday, display_order, created_at, updated_at"
      )
      .order("display_order", { ascending: true })
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
      key: row?.key || "",
      name: row?.name || "",
      is_paid: row?.is_paid ?? true,
      is_active: row?.is_active ?? true,
      allows_half_day: row?.allows_half_day ?? false,
      requires_approval: row?.requires_approval ?? true,
      counts_weekly_off: row?.counts_weekly_off ?? false,
      counts_holiday: row?.counts_holiday ?? false,
      display_order: row?.display_order ?? 100,
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
      setFormError("Only HR/admin can manage leave types.");
      return;
    }
    if (!form.key.trim() || !form.name.trim()) {
      setFormError("Key and name are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload = {
      key: form.key.trim(),
      name: form.name.trim(),
      is_paid: form.is_paid,
      is_active: form.is_active,
      allows_half_day: form.allows_half_day,
      requires_approval: form.requires_approval,
      counts_weekly_off: form.counts_weekly_off,
      counts_holiday: form.counts_holiday,
      display_order: form.display_order,
    };

    const { error } = form.id
      ? await supabase.from("erp_hr_leave_types").update(payload).eq("id", form.id)
      : await supabase.from("erp_hr_leave_types").insert(payload);

    if (error) {
      if (error.code === "23505") {
        setFormError("Leave type key must be unique for your company.");
      } else {
        setFormError(error.message || "Unable to save leave type.");
      }
      setSaving(false);
      return;
    }

    setToast({
      type: "success",
      message: `Leave type ${form.id ? "updated" : "created"} successfully.`,
    });
    setSaving(false);
    closeModal();
    await loadLeaveTypes();
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

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Leave</p>
        <h1 style={titleStyle}>Leave Types</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>

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
          <Link href="/erp/hr" style={linkStyle}>
            ← Back to HR Home
          </Link>
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
            placeholder="Search by key or name"
            style={searchInputStyle}
          />
          <span style={{ color: "#6b7280" }}>Total: {filteredLeaveTypes.length}</span>
        </div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Key</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Half-day</th>
                <th style={thStyle}>Approval</th>
                <th style={thStyle}>Weekly Off</th>
                <th style={thStyle}>Holiday</th>
                <th style={thStyle}>Order</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeaveTypes.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ ...tdStyle, textAlign: "center" }}>
                    No leave types found.
                  </td>
                </tr>
              ) : (
                filteredLeaveTypes.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.key}</td>
                    <td style={tdStyle}>{row.name}</td>
                    <td style={tdStyle}>{row.is_paid ? "Paid" : "Unpaid"}</td>
                    <td style={tdStyle}>{row.allows_half_day ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{row.requires_approval ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{row.counts_weekly_off ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{row.counts_holiday ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{row.display_order}</td>
                    <td style={tdStyle}>{row.is_active ? "Active" : "Inactive"}</td>
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
                  Configure paid/unpaid leave and leave request behavior.
                </p>
              </div>
              <button type="button" onClick={closeModal} style={buttonStyle}>Close</button>
            </div>
            <form onSubmit={handleSave} style={formGridStyle}>
              <label style={labelStyle}>
                Key *
                <input
                  value={form.key}
                  onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
                  placeholder="e.g., casual_leave"
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
                Display Order
                <input
                  type="number"
                  value={form.display_order}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      display_order: Number.isNaN(e.target.valueAsNumber)
                        ? 0
                        : e.target.valueAsNumber,
                    }))
                  }
                  min={0}
                  step={1}
                  style={inputStyle}
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
                Allows Half Day
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.allows_half_day}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, allows_half_day: e.target.checked }))
                    }
                  />
                  <span style={{ color: "#4b5563" }}>Half-day requests permitted</span>
                </div>
              </label>
              <label style={labelStyle}>
                Requires Approval
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.requires_approval}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, requires_approval: e.target.checked }))
                    }
                  />
                  <span style={{ color: "#4b5563" }}>Approval needed before booking</span>
                </div>
              </label>
              <label style={labelStyle}>
                Counts Weekly Off
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.counts_weekly_off}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, counts_weekly_off: e.target.checked }))
                    }
                  />
                  <span style={{ color: "#4b5563" }}>Include weekly offs in leave days</span>
                </div>
              </label>
              <label style={labelStyle}>
                Counts Holiday
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={form.counts_holiday}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, counts_holiday: e.target.checked }))
                    }
                  />
                  <span style={{ color: "#4b5563" }}>Include holidays in leave days</span>
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
  margin: "0 auto",
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
