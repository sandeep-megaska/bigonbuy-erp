import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../../lib/supabaseClient";
import ErpShell from "../../../../components/erp/ErpShell";

type DesignationRow = {
  id: string;
  code: string | null;
  name: string | null;
  department: string | null;
  is_active: boolean | null;
};

type PermissionRow = {
  perm_key: string;
  label: string;
  module_key: string;
  allowed: boolean;
};

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

async function fetchJson(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = safeJsonParse(text);
  return { res, data, text };
}

export default function HrDesignationRbacPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [designations, setDesignations] = useState<DesignationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [baseline, setBaseline] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      setSuccess("");

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session) {
        router.replace("/");
        return;
      }

      if (!active) return;

      const token = sessionData.session.access_token;
      setAccessToken(token);

      const { res, data } = await fetchJson("/api/erp/hr/rbac/designations", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to load designations.");
        setLoading(false);
        return;
      }

      const list = (data.designations as DesignationRow[]) ?? [];
      setDesignations(list);
      if (list.length > 0) {
        setSelectedId((prev) => prev || list[0].id);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!selectedId || !accessToken) return;
      setError("");
      setSuccess("");
      const { res, data } = await fetchJson(`/api/erp/hr/rbac/designations/${selectedId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok || !data?.ok) {
        if (active) {
          setError(data?.error || "Unable to load permissions.");
        }
        return;
      }

      const rows = (data.permissions as PermissionRow[]) ?? [];
      if (active) {
        setPermissions(rows);
        setBaseline(Object.fromEntries(rows.map((row) => [row.perm_key, row.allowed])));
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, selectedId]);

  const permissionGroups = useMemo(() => {
    return permissions.reduce((acc, perm) => {
      const groupKey = perm.module_key || "other";
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(perm);
      return acc;
    }, {} as Record<string, PermissionRow[]>);
  }, [permissions]);

  const changedCount = useMemo(() => {
    return permissions.filter((perm) => baseline[perm.perm_key] !== perm.allowed).length;
  }, [permissions, baseline]);

  function handleToggle(permKey: string) {
    setPermissions((prev) =>
      prev.map((perm) =>
        perm.perm_key === permKey ? { ...perm, allowed: !perm.allowed } : perm
      )
    );
  }

  async function handleSave() {
    if (!selectedId || !accessToken) return;
    setSaving(true);
    setError("");
    setSuccess("");

    const updates = permissions.filter((perm) => baseline[perm.perm_key] !== perm.allowed);

    try {
      for (const perm of updates) {
        const { res, data } = await fetchJson(`/api/erp/hr/rbac/designations/${selectedId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ perm_key: perm.perm_key, allowed: perm.allowed }),
        });

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to update permission.");
        }
      }

      setBaseline(Object.fromEntries(permissions.map((row) => [row.perm_key, row.allowed])));
      setSuccess("Permissions updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update permissions.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading RBAC…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR · RBAC</p>
            <h1 style={h1Style}>Designation Permissions</h1>
            <p style={subtitleStyle}>Define which modules each designation can access.</p>
          </div>
          <div>
            <Link href="/erp/hr" style={linkStyle}>
              ← Back to HR Home
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {success ? <div style={successStyle}>{success}</div> : null}

        <div style={contentGridStyle}>
          <aside style={listStyle}>
            <div style={listHeaderStyle}>Designations</div>
            {designations.map((designation) => {
              const label = designation.name || designation.code || designation.id;
              const isActive = designation.is_active !== false;
              const isSelected = designation.id === selectedId;
              return (
                <button
                  key={designation.id}
                  type="button"
                  onClick={() => setSelectedId(designation.id)}
                  style={{
                    ...listItemStyle,
                    ...(isSelected ? listItemActiveStyle : null),
                  }}
                >
                  <span>{label}</span>
                  {!isActive ? <span style={inactiveBadgeStyle}>Inactive</span> : null}
                </button>
              );
            })}
          </aside>

          <section style={detailStyle}>
            <div style={detailHeaderStyle}>
              <h2 style={detailTitleStyle}>Permissions</h2>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || changedCount === 0}
                style={{
                  ...primaryButtonStyle,
                  ...(saving || changedCount === 0 ? disabledButtonStyle : null),
                }}
              >
                {saving ? "Saving…" : `Save changes${changedCount ? ` (${changedCount})` : ""}`}
              </button>
            </div>

            {selectedId ? (
              Object.keys(permissionGroups).length > 0 ? (
                Object.entries(permissionGroups).map(([moduleKey, rows]) => (
                  <div key={moduleKey} style={moduleCardStyle}>
                    <div style={moduleHeaderStyle}>{moduleKey}</div>
                    <div style={moduleGridStyle}>
                      {rows.map((perm) => (
                        <label key={perm.perm_key} style={permissionRowStyle}>
                          <input
                            type="checkbox"
                            checked={perm.allowed}
                            onChange={() => handleToggle(perm.perm_key)}
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div style={emptyStateStyle}>No permissions configured yet.</div>
              )
            ) : (
              <div style={emptyStateStyle}>Select a designation to view permissions.</div>
            )}
          </section>
        </div>
      </div>
    </ErpShell>
  );
}

const pageContainerStyle = {
  padding: "32px 24px",
  minHeight: "100vh",
  background: "#f8fafc",
};

const pageHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap" as const,
};

const eyebrowStyle = { fontSize: 12, letterSpacing: 1, color: "#6b7280" };

const h1Style = { margin: "6px 0", fontSize: 28 };

const subtitleStyle = { margin: 0, color: "#4b5563" };

const linkStyle = { color: "#2563eb", textDecoration: "none", fontWeight: 600 };

const errorStyle = {
  marginTop: 16,
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 600,
};

const successStyle = {
  marginTop: 16,
  padding: "10px 12px",
  borderRadius: 10,
  background: "#dcfce7",
  color: "#166534",
  fontWeight: 600,
};

const contentGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 280px) 1fr",
  gap: 20,
  marginTop: 24,
};

const listStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  padding: 12,
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
  maxHeight: "70vh",
  overflowY: "auto" as const,
};

const listHeaderStyle = {
  fontWeight: 700,
  marginBottom: 4,
  color: "#111827",
};

const listItemStyle = {
  border: "1px solid transparent",
  borderRadius: 10,
  padding: "10px 12px",
  background: "#f9fafb",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  cursor: "pointer",
  fontWeight: 600,
  color: "#111827",
};

const listItemActiveStyle = {
  borderColor: "#2563eb",
  background: "#eff6ff",
};

const inactiveBadgeStyle = {
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 999,
  background: "#fef3c7",
  color: "#92400e",
};

const detailStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  padding: 20,
};

const detailHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
  gap: 12,
  flexWrap: "wrap" as const,
};

const detailTitleStyle = { margin: 0, fontSize: 20 };

const primaryButtonStyle = {
  border: "none",
  borderRadius: 10,
  background: "#2563eb",
  color: "white",
  padding: "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

const disabledButtonStyle = {
  opacity: 0.6,
  cursor: "not-allowed",
};

const moduleCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};

const moduleHeaderStyle = {
  fontWeight: 700,
  marginBottom: 12,
  textTransform: "capitalize" as const,
};

const moduleGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const permissionRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 600,
};

const emptyStateStyle = {
  padding: 16,
  borderRadius: 10,
  background: "#f3f4f6",
  color: "#6b7280",
  fontWeight: 600,
};
