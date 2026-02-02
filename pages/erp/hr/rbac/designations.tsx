import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type DesignationRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type PermissionRow = {
  perm_key: string;
  label: string;
  module_key: string;
  allowed: boolean;
};

type ApiListResp =
  | { ok: true; designations: DesignationRow[] }
  | { ok: false; error: string };

type ApiPermResp =
  | { ok: true; permissions: PermissionRow[] }
  | { ok: false; error: string };

// Browser-only Supabase client (no dependency on repo's supabaseClient file)
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

function groupByModule(rows: PermissionRow[]) {
  const m = new Map<string, PermissionRow[]>();
  for (const r of rows) {
    const key = r.module_key || "other";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(r);
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function HrRbacDesignationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [designations, setDesignations] = useState<DesignationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [original, setOriginal] = useState<Map<string, boolean>>(new Map());

  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupByModule(permissions), [permissions]);

  async function getAccessToken(): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  }

  async function loadDesignations() {
    setError(null);
    setLoading(true);

    if (!supabase) {
      setLoading(false);
      setError("Supabase env vars missing in browser (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("Not authenticated. Please sign in again.");
      return;
    }

    const resp = await fetch("/api/erp/hr/rbac/designations", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = (await resp.json()) as ApiListResp;
    if (!json.ok) {
      setLoading(false);
      setError(json.error);
      return;
    }

    const active = (json.designations || []).filter((d) => d.is_active);
    setDesignations(active);
    setSelectedId(active.length ? active[0].id : null);

    setLoading(false);
  }

  async function loadPermissions(hrDesignationId: string) {
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError("Not authenticated. Please sign in again.");
      return;
    }

    const resp = await fetch(`/api/erp/hr/rbac/designations/${hrDesignationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = (await resp.json()) as ApiPermResp;
    if (!json.ok) {
      setError(json.error);
      return;
    }

    const rows = json.permissions ?? [];
    setPermissions(rows);

    const m = new Map<string, boolean>();
    for (const r of rows) m.set(r.perm_key, !!r.allowed);
    setOriginal(m);
  }

  useEffect(() => {
    loadDesignations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) loadPermissions(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function togglePerm(permKey: string) {
    setPermissions((prev) =>
      prev.map((p) => (p.perm_key === permKey ? { ...p, allowed: !p.allowed } : p))
    );
  }

  function getChanges(): Array<{ perm_key: string; allowed: boolean }> {
    const changes: Array<{ perm_key: string; allowed: boolean }> = [];
    for (const p of permissions) {
      const oldVal = original.get(p.perm_key);
      if (oldVal === undefined) continue;
      if (oldVal !== !!p.allowed) changes.push({ perm_key: p.perm_key, allowed: !!p.allowed });
    }
    return changes;
  }

  async function saveChanges() {
    if (!selectedId) return;
    const changes = getChanges();
    if (!changes.length) return;

    setSaving(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      setError("Not authenticated. Please sign in again.");
      return;
    }

    for (const ch of changes) {
      const resp = await fetch(`/api/erp/hr/rbac/designations/${selectedId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(ch),
      });

      const json = (await resp.json()) as ApiPermResp;
      if (!json.ok) {
        setSaving(false);
        setError(json.error);
        return;
      }
    }

    await loadPermissions(selectedId);
    setSaving(false);
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>HR · RBAC</div>
          <h1 style={{ margin: "6px 0 6px", fontSize: 34 }}>Designation Permissions</h1>
          <div style={{ opacity: 0.75 }}>Define which modules each designation can access.</div>
        </div>

        <button
          onClick={saveChanges}
          disabled={saving || !getChanges().length || !selectedId}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: saving ? "#eee" : "#3b82f6",
            color: saving ? "#444" : "white",
            cursor: saving ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>

      {error ? (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #fca5a5", color: "#b91c1c" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18, marginTop: 18 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Designations</div>

          {loading ? (
            <div style={{ opacity: 0.75 }}>Loading...</div>
          ) : designations.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {designations.map((d) => {
                const active = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: active ? "2px solid #3b82f6" : "1px solid #eee",
                      background: active ? "#eff6ff" : "white",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {d.name}
                    <span style={{ marginLeft: 8, opacity: 0.6, fontWeight: 500 }}>({d.code})</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ opacity: 0.75 }}>No active designations found.</div>
          )}
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>Permissions</h2>

          {!selectedId ? (
            <div style={{ opacity: 0.75 }}>Select a designation.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {grouped.map(([moduleKey, rows]) => (
                <div key={moduleKey} style={{ border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>
                    {moduleKey === "self-service" ? "Self-Service" : moduleKey}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                    {rows.map((p) => (
                      <label
                        key={p.perm_key}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          border: "1px solid #eee",
                          borderRadius: 12,
                          padding: "10px 12px",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input type="checkbox" checked={!!p.allowed} onChange={() => togglePerm(p.perm_key)} />
                        <span style={{ fontWeight: 600 }}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {permissions.length === 0 ? <div style={{ opacity: 0.75 }}>No permissions found.</div> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
