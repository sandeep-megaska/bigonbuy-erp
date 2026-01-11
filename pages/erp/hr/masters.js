import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import {
  listDepartments,
  listEmploymentTypes,
  listJobTitles,
  listLocations,
  upsertDepartment,
  upsertEmploymentType,
  upsertJobTitle,
  upsertLocation,
} from "../../../lib/hrMastersApi";
import { supabase } from "../../../lib/supabaseClient";

const TAB_CONFIG = {
  departments: {
    label: "Departments",
    itemLabel: "department",
    listFn: listDepartments,
    upsertFn: upsertDepartment,
    empty: { id: null, name: "", code: "", is_active: true },
    searchKeys: ["name", "code"],
    requiredKeys: ["name"],
    fields: [
      { key: "name", label: "Department Name", placeholder: "e.g., Operations", required: true },
      { key: "code", label: "Code", placeholder: "Optional short code" },
      { key: "is_active", label: "Active", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "code", label: "Code" },
      { key: "is_active", label: "Status", render: (row) => (row.is_active ? "Active" : "Inactive") },
      { key: "updated_at", label: "Updated", render: (row) => formatDate(row.updated_at) },
    ],
  },
  jobTitles: {
    label: "Job Titles",
    itemLabel: "job title",
    listFn: listJobTitles,
    upsertFn: upsertJobTitle,
    empty: { id: null, title: "", level: "", is_active: true },
    searchKeys: ["title", "level"],
    requiredKeys: ["title"],
    fields: [
      { key: "title", label: "Job Title", placeholder: "e.g., Senior Engineer", required: true },
      { key: "level", label: "Level", type: "number", placeholder: "Optional level" },
      { key: "is_active", label: "Active", type: "checkbox" },
    ],
    columns: [
      { key: "title", label: "Title" },
      { key: "level", label: "Level", render: (row) => row.level ?? "—" },
      { key: "is_active", label: "Status", render: (row) => (row.is_active ? "Active" : "Inactive") },
      { key: "updated_at", label: "Updated", render: (row) => formatDate(row.updated_at) },
    ],
  },
  locations: {
    label: "Locations",
    itemLabel: "location",
    listFn: listLocations,
    upsertFn: upsertLocation,
    empty: { id: null, name: "", country: "", state: "", city: "", is_active: true },
    searchKeys: ["name", "city", "state", "country"],
    requiredKeys: ["name"],
    fields: [
      { key: "name", label: "Location Name", placeholder: "e.g., Bengaluru", required: true },
      { key: "country", label: "Country", placeholder: "Country" },
      { key: "state", label: "State", placeholder: "State" },
      { key: "city", label: "City", placeholder: "City" },
      { key: "is_active", label: "Active", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Name" },
      {
        key: "country",
        label: "Region",
        render: (row) => [row.city, row.state, row.country].filter(Boolean).join(", ") || "—",
      },
      { key: "is_active", label: "Status", render: (row) => (row.is_active ? "Active" : "Inactive") },
      { key: "updated_at", label: "Updated", render: (row) => formatDate(row.updated_at) },
    ],
  },
  employmentTypes: {
    label: "Employment Types",
    itemLabel: "employment type",
    listFn: listEmploymentTypes,
    upsertFn: upsertEmploymentType,
    empty: { id: null, key: "", name: "", is_active: true },
    searchKeys: ["key", "name"],
    requiredKeys: ["key", "name"],
    fields: [
      { key: "key", label: "Key", placeholder: "e.g., permanent", required: true },
      { key: "name", label: "Display Name", placeholder: "e.g., Permanent", required: true },
      { key: "is_active", label: "Active", type: "checkbox" },
    ],
    columns: [
      { key: "key", label: "Key" },
      { key: "name", label: "Name" },
      { key: "is_active", label: "Status", render: (row) => (row.is_active ? "Active" : "Inactive") },
      { key: "updated_at", label: "Updated", render: (row) => formatDate(row.updated_at) },
    ],
  },
};

const TAB_ORDER = ["departments", "jobTitles", "locations", "employmentTypes"];

const initialTabState = TAB_ORDER.reduce((acc, key) => {
  acc[key] = { loading: false, error: "", loaded: false };
  return acc;
}, {});

export default function HrMastersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("departments");
  const [tabState, setTabState] = useState(initialTabState);
  const [records, setRecords] = useState({
    departments: [],
    jobTitles: [],
    locations: [],
    employmentTypes: [],
  });
  const [searchTerms, setSearchTerms] = useState({
    departments: "",
    jobTitles: "",
    locations: "",
    employmentTypes: "",
  });
  const [modalState, setModalState] = useState({
    open: false,
    tabKey: "departments",
    values: { ...TAB_CONFIG.departments.empty },
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

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
        setTabState((prev) => ({
          ...prev,
          departments: {
            ...prev.departments,
            error: context.membershipError || "No active company membership found for this user.",
          },
        }));
        setLoading(false);
        return;
      }

      await loadRecords("departments");
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    const state = tabState[activeTab];
    if (!state?.loaded && !state?.loading) {
      loadRecords(activeTab);
    }
  }, [activeTab, ctx?.companyId, tabState]);

  async function loadRecords(tabKey) {
    const config = TAB_CONFIG[tabKey];
    if (!config) return;

    setTabState((prev) => ({
      ...prev,
      [tabKey]: { ...prev[tabKey], loading: true, error: "" },
    }));

    try {
      const data = await config.listFn();
      setRecords((prev) => ({ ...prev, [tabKey]: Array.isArray(data) ? data : [] }));
      setTabState((prev) => ({
        ...prev,
        [tabKey]: { ...prev[tabKey], loading: false, loaded: true },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to load ${config.label}`;
      setTabState((prev) => ({
        ...prev,
        [tabKey]: { ...prev[tabKey], loading: false, error: message },
      }));
    }
  }

  function openModal(tabKey, row = null) {
    const config = TAB_CONFIG[tabKey];
    setModalState({
      open: true,
      tabKey,
      values: row ? { ...row } : { ...config.empty },
    });
    setFormError("");
  }

  function closeModal() {
    setModalState((prev) => ({ ...prev, open: false }));
    setFormError("");
  }

  function showToast(nextToast) {
    setToast(nextToast);
    if (nextToast) {
      window.setTimeout(() => {
        setToast(null);
      }, 3000);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!canManage) return;
    const config = TAB_CONFIG[modalState.tabKey];
    if (!config) return;

    const missing = config.requiredKeys.find(
      (key) => !String(modalState.values[key] ?? "").trim()
    );
    if (missing) {
      setFormError(`Please enter ${missing.replace("_", " ")}.`);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const payload = buildUpsertPayload(modalState.tabKey, modalState.values);
      await config.upsertFn(payload);
      showToast({ type: "success", message: `${config.label} saved successfully.` });
      await loadRecords(modalState.tabKey);
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to save ${config.label}`;
      showToast({ type: "error", message });
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(tabKey, row) {
    if (!canManage) return;
    const config = TAB_CONFIG[tabKey];
    if (!config) return;
    try {
      const payload = buildUpsertPayload(tabKey, { ...row, is_active: !row.is_active });
      await config.upsertFn(payload);
      showToast({
        type: "success",
        message: `${config.label} ${row.is_active ? "deactivated" : "activated"}.`,
      });
      await loadRecords(tabKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update status";
      showToast({ type: "error", message });
      setTabState((prev) => ({
        ...prev,
        [tabKey]: { ...prev[tabKey], error: message },
      }));
    }
  }

  const currentConfig = TAB_CONFIG[activeTab];
  const searchValue = (searchTerms[activeTab] || "").trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    const list = records[activeTab] || [];
    if (!searchValue) return list;
    const keys = currentConfig.searchKeys || [];
    return list.filter((row) =>
      keys.some((key) => String(row?.[key] ?? "").toLowerCase().includes(searchValue))
    );
  }, [activeTab, currentConfig.searchKeys, records, searchValue]);

  if (loading) return <div style={containerStyle}>Loading HR Masters…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR Masters</h1>
        <p style={{ color: "#b91c1c" }}>{tabState.departments.error || "No company linked to this account."}</p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace("/");
          }}
          style={dangerButtonStyle}
        >
          Sign Out
        </button>
      </div>
    );
  }

  const tabMeta = tabState[activeTab];

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <div style={headerStyle}>
        <div>
          <nav style={breadcrumbStyle}>
            <Link href="/erp" style={breadcrumbLinkStyle}>ERP Home</Link>
            <span style={breadcrumbSeparatorStyle}>/</span>
            <Link href="/erp/hr" style={breadcrumbLinkStyle}>HR Home</Link>
            <span style={breadcrumbSeparatorStyle}>/</span>
            <span style={breadcrumbCurrentStyle}>HR Masters</span>
          </nav>
          <p style={eyebrowStyle}>HR</p>
          <h1 style={titleStyle}>HR Masters</h1>
          <p style={subtitleStyle}>Manage foundational HR data used across employees.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role:{" "}
            <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to HR Home</Link>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>ERP Home</Link>
        </div>
      </div>

      <div style={tabsRowStyle}>
        {TAB_ORDER.map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(tabKey)}
            style={{
              ...tabButtonStyle,
              ...(activeTab === tabKey ? tabButtonActiveStyle : {}),
            }}
          >
            {TAB_CONFIG[tabKey].label}
          </button>
        ))}
      </div>

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>{currentConfig.label}</h2>
            <p style={{ margin: 0, color: "#6b7280" }}>
              {currentConfig.label} are shared across employee profiles and dropdowns.
            </p>
          </div>
          {canManage ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => openModal(activeTab)} style={buttonStyle}>Add {currentConfig.itemLabel}</button>
            </div>
          ) : null}
        </div>

        {!canManage ? (
          <div style={{ color: "#6b7280" }}>Read-only mode. Only owner/admin/hr can add or edit.</div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <div style={tableHeaderStyle}>
            <span>
              {currentConfig.label} ({filteredRecords.length}
              {filteredRecords.length !== (records[activeTab]?.length || 0)
                ? ` of ${records[activeTab]?.length || 0}`
                : ""}
              )
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
            <input
              type="text"
              placeholder={`Search ${currentConfig.label.toLowerCase()}...`}
              value={searchTerms[activeTab] || ""}
              onChange={(e) =>
                setSearchTerms((prev) => ({ ...prev, [activeTab]: e.target.value }))
              }
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setSearchTerms((prev) => ({ ...prev, [activeTab]: "" }))}
              style={buttonStyle}
            >
              Clear
            </button>
          </div>

          {tabMeta?.error ? (
            <div style={errorBoxStyle}>
              <div>{tabMeta.error}</div>
              <button type="button" onClick={() => loadRecords(activeTab)} style={retryButtonStyle}>
                Retry
              </button>
            </div>
          ) : null}

          {toast ? (
            <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
          ) : null}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {currentConfig.columns.map((col) => (
                    <th key={col.key} style={thStyle}>{col.label}</th>
                  ))}
                  {canManage ? <th style={thStyle}></th> : null}
                </tr>
              </thead>
              <tbody>
                {tabMeta?.loading ? (
                  <tr>
                    <td style={tdStyle} colSpan={currentConfig.columns.length + (canManage ? 1 : 0)}>
                      Loading {currentConfig.label.toLowerCase()}...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={currentConfig.columns.length + (canManage ? 1 : 0)}>
                      <div style={emptyStateStyle}>
                        <div>
                          <div style={{ fontWeight: 700 }}>No {currentConfig.itemLabel}s yet.</div>
                          <div style={{ color: "#6b7280" }}>
                            {searchValue
                              ? "No matches for this search."
                              : `Add your first ${currentConfig.itemLabel} to get started.`}
                          </div>
                        </div>
                        {canManage ? (
                          <button onClick={() => openModal(activeTab)} style={primaryButtonStyle}>
                            Add {currentConfig.itemLabel}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((row) => (
                    <tr key={row.id}>
                      {currentConfig.columns.map((col) => (
                        <td key={col.key} style={tdStyle}>
                          {col.render ? col.render(row) : row[col.key] || "—"}
                        </td>
                      ))}
                      {canManage ? (
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => openModal(activeTab, row)} style={smallButtonStyle}>Edit</button>
                            <button
                              onClick={() => handleToggleStatus(activeTab, row)}
                              style={smallButtonStyle}
                            >
                              {row.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalState.open ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {modalState.values?.id ? "Edit" : "Add"} {TAB_CONFIG[modalState.tabKey].itemLabel}
                </h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Keep master data consistent for employee records.
                </p>
              </div>
              <button type="button" onClick={closeModal} style={buttonStyle}>Close</button>
            </div>
            <form onSubmit={handleSave} style={formGridStyle}>
              {TAB_CONFIG[modalState.tabKey].fields.map((field) => (
                <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontWeight: 600, color: "#111827" }}>
                    {field.label} {field.required ? "*" : ""}
                  </span>
                  {field.type === "checkbox" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(modalState.values[field.key])}
                        onChange={(e) =>
                          setModalState((prev) => ({
                            ...prev,
                            values: { ...prev.values, [field.key]: e.target.checked },
                          }))
                        }
                      />
                      <span style={{ color: "#4b5563" }}>Active</span>
                    </div>
                  ) : (
                    <input
                      type={field.type || "text"}
                      required={Boolean(field.required)}
                      value={modalState.values[field.key] ?? ""}
                      placeholder={field.placeholder || ""}
                      onChange={(e) =>
                        setModalState((prev) => ({
                          ...prev,
                          values: { ...prev.values, [field.key]: e.target.value },
                        }))
                      }
                      style={inputStyle}
                    />
                  )}
                </label>
              ))}
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

function buildUpsertPayload(tabKey, values) {
  const base = {
    id: values.id || null,
    is_active:
      typeof values.is_active === "boolean"
        ? values.is_active
        : String(values.is_active ?? "").toLowerCase() !== "false",
  };

  switch (tabKey) {
    case "departments":
      return {
        ...base,
        name: values.name || null,
        code: values.code || null,
      };
    case "jobTitles":
      return {
        ...base,
        title: values.title || null,
        level: values.level === "" || values.level === null ? null : Number(values.level),
      };
    case "locations":
      return {
        ...base,
        name: values.name || null,
        country: values.country || null,
        state: values.state || null,
        city: values.city || null,
      };
    case "employmentTypes":
      return {
        ...base,
        key: values.key || null,
        name: values.name || null,
      };
    default:
      return base;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

const containerStyle = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 18,
  flexWrap: "wrap",
};

const breadcrumbStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#6b7280",
  marginBottom: 8,
};

const breadcrumbLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};

const breadcrumbSeparatorStyle = {
  color: "#9ca3af",
};

const breadcrumbCurrentStyle = {
  color: "#111827",
  fontWeight: 700,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = { margin: "4px 0 8px", fontSize: 28, color: "#111827" };
const subtitleStyle = { margin: 0, color: "#4b5563", fontSize: 15 };

const tabsRowStyle = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
  flexWrap: "wrap",
};

const tabButtonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  cursor: "pointer",
};

const tabButtonActiveStyle = {
  background: "#eef2ff",
  borderColor: "#6366f1",
  color: "#312e81",
  fontWeight: 700,
};

const panelStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginTop: 10,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
};

const buttonStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  cursor: "pointer",
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#2563eb",
  color: "#fff",
  border: "1px solid #1d4ed8",
};

const dangerButtonStyle = {
  ...buttonStyle,
  background: "#dc2626",
  color: "#fff",
  border: "1px solid #b91c1c",
};

const smallButtonStyle = { ...buttonStyle, padding: "8px 10px" };

const retryButtonStyle = {
  ...buttonStyle,
  marginTop: 10,
  background: "#fff",
  borderColor: "#fca5a5",
  color: "#b91c1c",
};

const tableHeaderStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 700,
};

const thStyle = { padding: 12, borderBottom: "1px solid #e5e7eb", textAlign: "left" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f3f4f6", verticalAlign: "top" };

const errorBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const successBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #86efac",
  background: "#f0fdf4",
  color: "#166534",
};

const emptyStateStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  background: "#f9fafb",
  borderRadius: 10,
  padding: 16,
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 40,
};

const modalCardStyle = {
  width: "min(720px, 100%)",
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.2)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
};
