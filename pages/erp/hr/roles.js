import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const CARD_STYLE = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const BUTTON_STYLE = {
  border: "none",
  background: "#dc2626",
  color: "white",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700,
};

function Badge({ tone = "gray", children }) {
  const palette = {
    gray: { bg: "#f3f4f6", fg: "#111827" },
    blue: { bg: "#eff6ff", fg: "#1e40af" },
    green: { bg: "#ecfdf5", fg: "#065f46" },
    red: { bg: "#fef2f2", fg: "#991b1b" },
  };
  const colors = palette[tone] || palette.gray;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: colors.bg,
        color: colors.fg,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = safeJsonParse(text);
  return { res, data, text };
}

export default function HrRolesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sessionEmail, setSessionEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [companyId, setCompanyId] = useState("");

  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");

  const canManage = useMemo(() => ["owner", "admin", "hr"].includes(roleKey), [roleKey]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  async function loadContextAndRoles() {
    setLoading(true);
    setError("");
    setSuccess("");

    const { data: sdata, error: serr } = await supabase.auth.getSession();
    if (serr || !sdata?.session) {
      router.replace("/");
      return;
    }

    setSessionEmail(sdata.session.user.email || "");

    const { data: member, error: merr } = await supabase
      .from("erp_company_users")
      .select("company_id, role_key, is_active")
      .eq("user_id", sdata.session.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (merr) {
      setError(merr.message);
      setLoading(false);
      return;
    }

    if (!member?.company_id) {
      setError("No active company membership found for this user.");
      setLoading(false);
      return;
    }

    setCompanyId(member.company_id);
    setRoleKey(member.role_key || "");

    try {
      const accessToken = sdata.session.access_token;
      const { res, data } = await fetchJson("/api/erp/hr/roles/list", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load roles (${res.status})`);
      }

      setRoles(data.roles || []);
    } catch (e) {
      setError(e?.message || "Unable to load roles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await loadContextAndRoles();
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleCreateRole(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const key = newKey.trim();
    const name = newName.trim();

    if (!key || !name) {
      setError("Role key and name are required.");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(key)) {
      setError("Role key must be lowercase and contain only a-z, 0-9, and underscore.");
      return;
    }

    try {
      const { data: sdata, error: serr } = await supabase.auth.getSession();
      if (serr || !sdata?.session) {
        throw new Error("Session expired. Please sign in again.");
      }

      setBusyKey(key);
      const { res, data } = await fetchJson("/api/erp/hr/roles/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sdata.session.access_token}`,
        },
        body: JSON.stringify({ key, name }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to create role");
      }

      setSuccess("Role created.");
      setNewKey("");
      setNewName("");
      await loadContextAndRoles();
    } catch (e) {
      setError(e?.message || "Unable to create role");
    } finally {
      setBusyKey("");
    }
  }

  async function handleUpdateRole(role, name) {
    setError("");
    setSuccess("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name cannot be empty.");
      return;
    }

    try {
      const { data: sdata, error: serr } = await supabase.auth.getSession();
      if (serr || !sdata?.session) {
        throw new Error("Session expired. Please sign in again.");
      }

      setBusyKey(role.key);
      const { res, data } = await fetchJson("/api/erp/hr/roles/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sdata.session.access_token}`,
        },
        body: JSON.stringify({ key: role.key, name: trimmed }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update role");
      }

      setSuccess("Role updated.");
      await loadContextAndRoles();
    } catch (e) {
      setError(e?.message || "Unable to update role");
    } finally {
      setBusyKey("");
    }
  }

  async function handleDeleteRole(role) {
    setError("");
    setSuccess("");

    if (role.usageCount > 0) return;

    try {
      const { data: sdata, error: serr } = await supabase.auth.getSession();
      if (serr || !sdata?.session) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (!window.confirm(`Delete role “${role.name}”?`)) return;

      setBusyKey(role.key);
      const { res, data } = await fetchJson("/api/erp/hr/roles/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sdata.session.access_token}`,
        },
        body: JSON.stringify({ key: role.key }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to delete role");
      }

      setSuccess("Role deleted.");
      await loadContextAndRoles();
    } catch (e) {
      setError(e?.message || "Unable to delete role");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div style={{ padding: 28, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>HR</div>
          <h1 style={{ margin: "6px 0 6px", fontSize: 44, lineHeight: 1.05 }}>Roles</h1>
          <div style={{ opacity: 0.75, marginBottom: 6 }}>Manage available roles and their permissions.</div>
          <div style={{ opacity: 0.75 }}>
            Signed in as <b>{sessionEmail || "—"}</b>
            {roleKey ? (
              <>
                {" "}
                · Role: <b>{roleKey}</b>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Link href="/erp/hr" style={{ marginTop: 8 }}>
            ← HR Home
          </Link>
          <Link href="/erp" style={{ marginTop: 8 }}>
            ERP Home
          </Link>
          <button onClick={signOut} style={BUTTON_STYLE}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 18 }} />

      {loading && <div>Loading…</div>}

      {!loading && error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: 12,
            borderRadius: 10,
            marginBottom: 14,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {!loading && success && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            color: "#065f46",
            padding: 12,
            borderRadius: 10,
            marginBottom: 14,
          }}
        >
          {success}
        </div>
      )}

      {!loading && !canManage && (
        <div style={{ marginBottom: 12 }}>
          <Badge tone="red">Read-only / Not permitted</Badge>{" "}
          <span style={{ opacity: 0.8 }}>Only owner/admin/hr can manage roles.</span>
        </div>
      )}

      {!loading && (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1.2fr 1fr" }}>
          <div style={CARD_STYLE}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Roles</div>
                <div style={{ opacity: 0.75, marginTop: 4 }}>Key, name, and usage count.</div>
              </div>
              <Badge tone="blue">{roles.length} roles</Badge>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Key</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Name</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Usage</th>
                    <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <RoleRow
                      key={role.key}
                      role={role}
                      canManage={canManage}
                      busy={busyKey === role.key}
                      onSave={(name) => handleUpdateRole(role, name)}
                      onDelete={() => handleDeleteRole(role)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={CARD_STYLE}>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Create Role</div>
            <form onSubmit={handleCreateRole}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontWeight: 700 }}>
                  Key
                  <input
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="owner, admin, hr, staff"
                    style={{
                      marginTop: 6,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      width: "100%",
                    }}
                    disabled={!canManage}
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Lowercase letters, numbers, underscores.</div>
                </label>

                <label style={{ fontWeight: 700 }}>
                  Name
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Administrator"
                    style={{
                      marginTop: 6,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      width: "100%",
                    }}
                    disabled={!canManage}
                  />
                </label>

                <button type="submit" disabled={!canManage || busyKey} style={{ ...BUTTON_STYLE, background: canManage ? "#16a34a" : "#9ca3af" }}>
                  Create Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleRow({ role, canManage, busy, onSave, onDelete }) {
  const [name, setName] = useState(role.name);

  useEffect(() => {
    setName(role.name);
  }, [role.name]);

  return (
    <tr>
      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ fontWeight: 900 }}>{role.key}</div>
      </td>
      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage || busy}
          style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}
        />
      </td>
      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <Badge tone={role.usageCount > 0 ? "blue" : "gray"}>{role.usageCount}</Badge>
      </td>
      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onSave(name)}
            disabled={!canManage || busy}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: canManage && !busy ? "pointer" : "not-allowed" }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canManage || busy || role.usageCount > 0}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: role.usageCount > 0 ? "#f3f4f6" : "#fff",
              cursor: canManage && !busy && role.usageCount === 0 ? "pointer" : "not-allowed",
              color: "#b91c1c",
            }}
            title={role.usageCount > 0 ? "Cannot delete a role in use" : "Delete role"}
          >
            {busy ? "..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}
