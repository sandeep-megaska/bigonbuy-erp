import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const emptyForm = {
  id: "" as string,
  code: "",
  name: "",
  sort_order: 0,
  is_active: true,
};

type EmployeeExitReason = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type FormState = typeof emptyForm;

export default function HrEmployeeExitReasonsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [exitReasons, setExitReasons] = useState<EmployeeExitReason[]>([]);
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

  const filteredExitReasons = useMemo(() => {
    if (!search.trim()) return exitReasons;
    const term = search.trim().toLowerCase();
    return exitReasons.filter((exitReason) =>
      [exitReason.code, exitReason.name].some((value) => value?.toLowerCase().includes(term))
    );
  }, [exitReasons, search]);

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

      await loadExitReasons();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadExitReasons() {
    const { data, error } = await supabase
      .from("erp_hr_employee_exit_reasons")
      .select("id, code, name, sort_order, is_active, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setExitReasons((data as EmployeeExitReason[]) || []);
  }

  function openModal(row?: EmployeeExitReason) {
    setForm({
      id: row?.id || "",
      code: row?.code || "",
      name: row?.name || "",
      sort_order: row?.sort_order ?? 0,
      is_active: row?.is_active ?? true,
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
      setFormError("Only HR/admin can manage employee exit reasons.");
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload = {
      code: form.code.trim(),
      company_id: ctx.companyId, 
      name: form.name.trim(),
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };

    const { error } = await supabase.rpc("erp_hr_employee_exit_reason_upsert", {
      p_id: form.id || null,
      p_code: payload.code,
      p_name: payload.name,
      p_sort_order: payload.sort_order,
      p_is_active: payload.is_active,
    });

    if (error) {
      if (error.code === "23505") {
        setFormError("Exit reason code or name must be unique for your company.");
      } else {
        setFormError(error.message || "Unable to save employee exit reason.");
      }
      setSaving(false);
      return;
    }

    setToast({
      type: "success",
      message: `Employee exit reason ${form.id ? "updated" : "created"} successfully.`,
    });
    setSaving(false);
    closeModal();
    await loadExitReasons();
  }

  async function handleToggleStatus(exitReason: EmployeeExitReason) {
    if (!canManage) return;
    const { error } = await supabase.rpc("erp_hr_employee_exit_reason_set_active", {
      p_id: exitReason.id,
      p_is_active: !exitReason.is_active,
    });
    if (error) {
      setToast({ type: "error", message: error.message || "Unable to update exit reason." });
      return;
    }
    await loadExitReasons();
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading employee exit reasons…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Employee Exit Reasons</h1>
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
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Masters</p>
          <h1 style={titleStyle}>Employee Exit Reasons</h1>
          <p style={subtitleStyle}>Maintain exit reason options for employee exits.</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {canManage ? (
            <button onClick={() => openModal()} style={primaryButtonStyle}>
              Add Exit Reason
            </button>
          ) : null}
          <Link href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </Link>
          <Link href="/erp/hr/masters" style={linkStyle}>
            Back to Masters
          </Link>
        </div>
      </header>

      {!canManage ? (
        <div style={readOnlyStyle}>Read-only mode. Only owner/admin/hr can add or edit.</div>
      ) : null}

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Exit Reasons</h3>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
              {filteredExitReasons.length} exit reasons
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search exit reasons"
            style={searchInputStyle}
          />
        </div>

        {!filteredExitReasons.length ? (
          <div style={emptyStateStyle}>
            <h4 style={{ marginTop: 0 }}>No exit reasons found</h4>
            <p style={{ margin: 0, color: "#6b7280" }}>
              {search.trim()
                ? "Try adjusting your search keywords or clear the filter."
                : "Add your first exit reason to get started."}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Active</th>
                  <th style={thStyle}>Sort Order</th>
                  {canManage ? <th style={{ ...thStyle, textAlign: "right" }}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredExitReasons.map((exitReason) => (
                  <tr key={exitReason.id}>
                    <td style={tdStyle}>{exitReason.code || "—"}</td>
                    <td style={tdStyle}>{exitReason.name || "—"}</td>
                    <td style={tdStyle}>{exitReason.is_active ? "Active" : "Inactive"}</td>
                    <td style={tdStyle}>{exitReason.sort_order ?? 0}</td>
                    {canManage ? (
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => openModal(exitReason)} style={smallButtonStyle}>
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(exitReason)}
                            style={smallButtonStyle}
                          >
                            {exitReason.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>{form.id ? "Edit" : "Add"} Exit Reason</h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Keep exit reason data consistent for employee exits.
                </p>
              </div>
              <button type="button" onClick={closeModal} style={buttonStyle}>
                Close
              </button>
            </div>
            <form onSubmit={handleSave} style={formGridStyle}>
              <label style={labelStyle}>
                Code *
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="RESIGN"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Name *
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Resigned"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Sort Order
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(event) =>
                    setForm({ ...form, sort_order: Number(event.target.value) || 0 })
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Active
                <select
                  value={form.is_active ? "active" : "inactive"}
                  onChange={(event) =>
                    setForm({ ...form, is_active: event.target.value === "active" })
                  }
                  style={inputStyle}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              {formError ? <div style={errorBoxStyle}>{formError}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <button type="button" onClick={closeModal} style={buttonStyle}>
                  Cancel
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={saving}>
                  {saving ? "Saving..." : form.id ? "Save Changes" : "Create Exit Reason"}
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
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 18,
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "4px 0 8px", fontSize: 28, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 600 };

const readOnlyStyle: CSSProperties = {
  background: "#fef3c7",
  color: "#92400e",
  padding: "10px 12px",
  borderRadius: 8,
  marginBottom: 16,
};

const panelStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#fff",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const searchInputStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  minWidth: 200,
};

const emptyStateStyle: CSSProperties = {
  padding: 24,
  borderRadius: 12,
  backgroundColor: "#f9fafb",
  textAlign: "center",
};

const thStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6b7280",
};

const tdStyle: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 14,
  color: "#111827",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#111827",
  borderColor: "#111827",
  color: "#fff",
};

const smallButtonStyle: CSSProperties = {
  ...buttonStyle,
  padding: "6px 10px",
  fontSize: 12,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "min(620px, 92vw)",
  boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 16,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
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
  fontSize: 14,
};

const successBoxStyle: CSSProperties = {
  backgroundColor: "#ecfdf3",
  border: "1px solid #bbf7d0",
  color: "#166534",
  padding: 10,
  borderRadius: 8,
  marginBottom: 12,
};

const errorBoxStyle: CSSProperties = {
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: 10,
  borderRadius: 8,
  gridColumn: "1 / -1",
};
