import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const TAB_CONFIG = {
  departments: {
    label: "Departments",
    apiType: "departments",
    empty: { id: null, name: "", code: "", is_active: true },
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
    apiType: "job-titles",
    empty: { id: null, title: "", level: "", is_active: true },
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
    apiType: "locations",
    empty: { id: null, name: "", country: "", state: "", city: "", is_active: true },
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
    apiType: "employment-types",
    empty: { id: null, key: "", name: "", is_active: true },
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

export default function HrMastersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined });
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("departments");
  const [records, setRecords] = useState({
    departments: [],
    jobTitles: [],
    locations: [],
    employmentTypes: [],
  });
  const [formValues, setFormValues] = useState({
    departments: TAB_CONFIG.departments.empty,
    jobTitles: TAB_CONFIG.jobTitles.empty,
    locations: TAB_CONFIG.locations.empty,
    employmentTypes: TAB_CONFIG.employmentTypes.empty,
  });

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
      setAccessToken(session.access_token || "");
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await Promise.all(TAB_ORDER.map((tabKey) => loadRecords(tabKey, session.access_token)));
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadRecords(tabKey, token = accessToken) {
    const config = TAB_CONFIG[tabKey];
    if (!config || !token) return;

    const res = await fetch(`/api/erp/hr/masters?type=${config.apiType}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || `Failed to load ${config.label}`);
      return;
    }
    setRecords((prev) => ({ ...prev, [tabKey]: data.rows || [] }));
  }

  function resetForm(tabKey) {
    setFormValues((prev) => ({ ...prev, [tabKey]: { ...TAB_CONFIG[tabKey].empty } }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!canManage) {
      setError("Only owner/admin/hr can manage masters.");
      return;
    }
    const config = TAB_CONFIG[activeTab];
    if (!config) return;
    const payload = { ...formValues[activeTab] };
    if (config.apiType === "job-titles" && payload.level !== "" && payload.level !== null) {
      payload.level = Number(payload.level);
    }

    const res = await fetch(`/api/erp/hr/masters?type=${config.apiType}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || `Failed to save ${config.label}`);
      return;
    }
    setError("");
    resetForm(activeTab);
    await loadRecords(activeTab);
  }

  function startEdit(tabKey, row) {
    setActiveTab(tabKey);
    setFormValues((prev) => ({ ...prev, [tabKey]: { ...row } }));
  }

  async function handleDeactivate(tabKey, row) {
    const config = TAB_CONFIG[tabKey];
    if (!config) return;
    const payload = { ...row, is_active: !row.is_active };
    const res = await fetch(`/api/erp/hr/masters?type=${config.apiType}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to update status");
      return;
    }
    setError("");
    await loadRecords(tabKey);
  }

  const currentConfig = TAB_CONFIG[activeTab];
  if (loading) return <div style={containerStyle}>Loading HR Masters…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR Masters</h1>
        <p style={{ color: "#b91c1c" }}>{error || "No company linked to this account."}</p>
        <button onClick={async () => { await supabase.auth.signOut(); router.replace("/"); }} style={dangerButtonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <div style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR</p>
          <h1 style={titleStyle}>HR Masters</h1>
          <p style={subtitleStyle}>Manage foundational HR data used across employees.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role:{" "}
            <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to HR Home</a>
          <a href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>ERP Home</a>
        </div>
      </div>

      {error ? (
        <div style={errorBoxStyle}>{error}</div>
      ) : null}

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
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => resetForm(activeTab)} style={buttonStyle}>New</button>
          </div>
        </div>

        {!canManage ? (
          <div style={{ color: "#6b7280" }}>Read-only mode. Only owner/admin/hr can add or edit.</div>
        ) : (
          <form onSubmit={handleSave} style={formGridStyle}>
            {currentConfig.fields.map((field) => (
              <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontWeight: 600, color: "#111827" }}>
                  {field.label} {field.required ? "*" : ""}
                </span>
                {field.type === "checkbox" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(formValues[activeTab][field.key])}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [activeTab]: { ...prev[activeTab], [field.key]: e.target.checked },
                        }))
                      }
                    />
                    <span style={{ color: "#4b5563" }}>Active</span>
                  </div>
                ) : (
                  <input
                    type={field.type || "text"}
                    required={Boolean(field.required)}
                    value={formValues[activeTab][field.key] ?? ""}
                    placeholder={field.placeholder || ""}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        [activeTab]: { ...prev[activeTab], [field.key]: e.target.value },
                      }))
                    }
                    style={inputStyle}
                  />
                )}
              </label>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" style={primaryButtonStyle}>Save</button>
              {formValues[activeTab]?.id ? (
                <span style={{ marginLeft: 12, color: "#6b7280" }}>
                  Editing record #{formValues[activeTab].id}
                </span>
              ) : null}
            </div>
          </form>
        )}

        <div style={{ marginTop: 20 }}>
          <div style={tableHeaderStyle}>
            <span>{currentConfig.label} ({records[activeTab]?.length || 0})</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {currentConfig.columns.map((col) => (
                    <th key={col.key} style={thStyle}>{col.label}</th>
                  ))}
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {(records[activeTab] || []).map((row) => (
                  <tr key={row.id}>
                    {currentConfig.columns.map((col) => (
                      <td key={col.key} style={tdStyle}>
                        {col.render ? col.render(row) : row[col.key] || "—"}
                      </td>
                    ))}
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={() => startEdit(activeTab, row)} style={smallButtonStyle}>Edit</button>
                        <button
                          onClick={() => handleDeactivate(activeTab, row)}
                          style={smallButtonStyle}
                          disabled={!canManage}
                        >
                          {row.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
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
};
