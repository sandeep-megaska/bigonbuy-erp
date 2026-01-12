import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const DEFAULT_FORM_STATE = { id: null, name: "", code: "" };

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Banner({ tone = "info", title, children, onDismiss }) {
  const theme =
    tone === "error"
      ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" }
      : tone === "success"
      ? { bg: "#ecfdf3", border: "#bbf7d0", color: "#166534" }
      : { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" };

  return (
    <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, color: theme.color, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          {title ? <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong> : null}
          <div>{children}</div>
        </div>
        {onDismiss ? (
          <button onClick={onDismiss} style={linkButtonStyle}>Dismiss</button>
        ) : null}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={linkButtonStyle}>Close</button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
        {footer ? <div style={{ marginTop: 20 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export default function MasterCrudPage({
  title,
  description,
  apiPath,
  itemLabel,
  tileHint,
  emptyMessage,
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined });
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");
  const [formState, setFormState] = useState(DEFAULT_FORM_STATE);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx?.roleKey]);
  const itemLabelTitle = useMemo(() => {
    if (!itemLabel) return title;
    return itemLabel.replace(/\\b\\w/g, (char) => char.toUpperCase());
  }, [itemLabel, title]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const name = String(row.name ?? "").toLowerCase();
      const code = String(row.code ?? "").toLowerCase();
      return name.includes(term) || code.includes(term);
    });
  }, [rows, searchTerm]);

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
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadRows();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, apiPath]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadRows() {
    setListLoading(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      const response = await fetch(apiPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to load records");
      }
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
    } finally {
      setListLoading(false);
    }
  }

  function openCreateModal() {
    setFormState({ ...DEFAULT_FORM_STATE });
    setFormError("");
    setFormOpen(true);
  }

  function openEditModal(row) {
    setFormState({
      id: row.id ?? null,
      name: row.name ?? "",
      code: row.code ?? "",
    });
    setFormError("");
    setFormOpen(true);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!formState.name.trim()) {
      setFormError("Name is required.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Your session expired. Please sign in again.");
        return;
      }
      const response = await fetch(apiPath, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: formState.id,
          name: formState.name.trim(),
          code: formState.code.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to save record");
      }
      setFormOpen(false);
      await loadRows();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save record");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row) {
    if (!row?.id) return;
    setListLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      const response = await fetch(apiPath, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: row.id,
          is_active: !row.is_active,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to update status");
      }
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setListLoading(false);
    }
  }

  if (loading) {
    return <div style={containerStyle}>Loading {title}…</div>;
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR Masters</p>
          <h1 style={titleStyle}>{title}</h1>
          <p style={subtitleStyle}>{description}</p>
          {tileHint ? <p style={hintStyle}>{tileHint}</p> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to HR</Link>
          <Link href="/erp/hr/masters" style={{ color: "#2563eb", textDecoration: "none" }}>All masters</Link>
        </div>
      </header>

      {!canManage ? (
        <Banner title="Read-only access">
          You can view {itemLabel} records, but only owner/admin/HR roles can create or update them.
        </Banner>
      ) : null}

      {error ? (
        <div style={{ marginTop: 16 }}>
          <Banner tone="error" title="Unable to load" onDismiss={() => setError("")}>{error}</Banner>
        </div>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <div style={toolbarStyle}>
          <input
            type="search"
            placeholder={`Search ${itemLabel} by name or code`}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={searchInputStyle}
          />
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={openCreateModal}
            disabled={!canManage}
          >
            + Add {itemLabelTitle}
          </button>
        </div>

        <div style={tableCardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td colSpan={5} style={tdStyle}>Loading records…</td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={tdStyle}>
                    {emptyMessage || `No ${itemLabel} found yet.`}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id || row.name}>
                    <td style={tdStyle}>{row.name || "—"}</td>
                    <td style={tdStyle}>{row.code || "—"}</td>
                    <td style={tdStyle}>
                      <label style={toggleLabelStyle}>
                        <input
                          type="checkbox"
                          checked={!!row.is_active}
                          onChange={() => handleToggle(row)}
                          disabled={!canManage}
                        />
                        <span style={{ marginLeft: 8 }}>{row.is_active ? "Active" : "Inactive"}</span>
                      </label>
                    </td>
                    <td style={tdStyle}>{formatDate(row.updated_at)}</td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        style={linkButtonStyle}
                        onClick={() => openEditModal(row)}
                        disabled={!canManage}
                      >
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

      {formOpen ? (
        <Modal
          title={`${formState.id ? "Edit" : "Add"} ${itemLabelTitle}`}
          onClose={() => setFormOpen(false)}
          footer={(
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setFormOpen(false)} style={secondaryButtonStyle}>Cancel</button>
              <button onClick={handleSave} style={primaryButtonStyle} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        >
          <form onSubmit={handleSave}>
            <label style={labelStyle}>
              Name<span style={{ color: "#ef4444" }}> *</span>
              <input
                type="text"
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Code
              <input
                type="text"
                value={formState.code}
                onChange={(event) => setFormState((prev) => ({ ...prev, code: event.target.value }))}
                style={inputStyle}
              />
            </label>
            {formError ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="error" title="Unable to save" onDismiss={() => setFormError("")}>{formError}</Banner>
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

const containerStyle = {
  maxWidth: 1120,
  margin: "72px auto",
  padding: "48px 56px 56px",
  borderRadius: 12,
  border: "1px solid #e7eaf0",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 30,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
  maxWidth: 600,
  lineHeight: 1.5,
};

const hintStyle = {
  margin: "8px 0 0",
  color: "#6b7280",
  fontSize: 14,
};

const toolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
};

const searchInputStyle = {
  minWidth: 260,
  flex: 1,
  maxWidth: 360,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const tableCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  marginTop: 16,
  overflowX: "auto",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 640,
};

const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  background: "#f9fafb",
  fontSize: 13,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle = {
  padding: "12px 16px",
  borderTop: "1px solid #eef1f6",
  fontSize: 14,
  color: "#111827",
};

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 14,
  color: "#374151",
  marginBottom: 16,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const toggleLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const primaryButtonStyle = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const secondaryButtonStyle = {
  padding: "10px 16px",
  backgroundColor: "#f3f4f6",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const linkButtonStyle = {
  padding: 0,
  border: "none",
  background: "transparent",
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 14,
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: 16,
};

const modalStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "100%",
  maxWidth: 480,
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
};
