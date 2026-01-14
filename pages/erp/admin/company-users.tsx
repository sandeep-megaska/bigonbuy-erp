import Link from "next/link";
import { useRouter } from "next/router";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

type RoleRow = { key: string; name?: string };
type CompanyUserRow = {
  user_id: string;
  email: string | null;
  role_key: string;
  created_at: string | null;
  updated_at: string | null;
};

export default function CompanyUsersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [users, setUsers] = useState<CompanyUserRow[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("employee");
  const [inviteDesignation, setInviteDesignation] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [listError, setListError] = useState("");

  const canManage = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      setAccessToken(session.access_token || "");
      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        isAuthenticated: accessState.isAuthenticated,
        isManager: accessState.isManager,
        roleKey: accessState.roleKey ?? undefined,
      });
      setCtx(context);
      if (!context.companyId) {
        setListError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (!accessState.isManager && !isHr(context.roleKey)) {
        setLoading(false);
        return;
      }

      await Promise.all([
        loadRoles(session.access_token, active),
        loadUsers(session.access_token, active),
      ]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadRoles(token: string, isActive = true) {
    if (!token) return;
    const res = await fetch("/api/hr/roles/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) return;
    if (isActive) {
      setRoles(data.roles || []);
      const preferred = data.roles?.find((r: RoleRow) => r.key === "employee")?.key;
      setInviteRole(preferred || data.roles?.[0]?.key || "employee");
    }
  }

  async function loadUsers(token: string, isActive = true) {
    if (!token) return;
    setListError("");
    const res = await fetch("/api/erp/company-users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      if (isActive) setListError(data?.error || "Failed to load company users");
      return;
    }

    if (isActive) setUsers(data.users || []);
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      setInviteError("Only owner/admin/hr can invite or grant access.");
      return;
    }
    if (!accessToken) {
      setInviteError("Missing session. Please sign in again.");
      return;
    }

    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setInviteError("Email is required.");
      return;
    }

    setInviteBusy(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const res = await fetch("/api/erp/company-users/invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: trimmedEmail,
          role_key: inviteRole,
          designation: inviteDesignation.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setInviteError(data?.error || "Failed to send invite");
        return;
      }

      setInviteSuccess(`Invite created / access granted for ${data.email} (${data.role_key}).`);
      setInviteEmail("");
      setInviteDesignation("");
      await loadUsers(accessToken);
    } finally {
      setInviteBusy(false);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading company users…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Company Users</h1>
        <p style={{ color: "#b91c1c" }}>{listError || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>Admin</p>
        <h1 style={titleStyle}>Company Users</h1>
        <div style={errorBox}>Not authorized. Contact your administrator for access.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp" style={linkButtonStyle}>
            Back to ERP Home
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
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={titleStyle}>Company Users</h1>
          <p style={subtitleStyle}>
            Invite staff, assign ERP roles, and manage who can sign in to your company.
          </p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>
            ← Back to ERP Home
          </Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </header>

      <div style={gridCols2}>
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Invite User</h2>
              <p style={{ margin: 0, color: "#4b5563" }}>
                Send an access invite email and assign their ERP role.
              </p>
            </div>
          </div>

          {inviteError ? <div style={errorBox}>{inviteError}</div> : null}
          {inviteSuccess ? <div style={okBox}>{inviteSuccess}</div> : null}

          <form onSubmit={handleInvite} style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div style={gridCols2}>
              <label style={labelStyle}>
                Email
                <input
                  style={inputStyle}
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                />
              </label>
              <label style={labelStyle}>
                Role
                <select
                  style={selectStyle}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name || role.key}
                    </option>
                  ))}
                  {!roles.length ? <option value="employee">employee</option> : null}
                </select>
              </label>
            </div>

            <label style={labelStyle}>
              Designation (optional)
              <input
                style={inputStyle}
                value={inviteDesignation}
                onChange={(e) => setInviteDesignation(e.target.value)}
                placeholder="HR Manager, Finance Lead…"
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                style={{ ...buttonStyle, background: "#2563eb" }}
                disabled={inviteBusy}
              >
                {inviteBusy ? "Sending..." : "Send invite"}
              </button>
            </div>
          </form>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Company Users</h2>
              <p style={{ margin: 0, color: "#4b5563" }}>Active users for this ERP account.</p>
            </div>
            <button
              type="button"
              onClick={() => loadUsers(accessToken)}
              style={{ ...buttonStyle, background: "#111827" }}
            >
              Refresh
            </button>
          </div>

          {listError ? <div style={errorBox}>{listError}</div> : null}
          {!listError && users.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No users yet. Invite your first employee.</p>
          ) : null}

          {!listError && users.length > 0 ? (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Created / Invited</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.user_id}>
                      <td style={tdStyle}>{user.email || "—"}</td>
                      <td style={tdStyle}>{user.role_key}</td>
                      <td style={tdStyle}>Active</td>
                      <td style={tdStyle}>{formatDate(user.created_at || user.updated_at)}</td>
                      <td style={{ ...tdStyle, color: "#9ca3af" }}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString();
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "36px 44px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Inter, Arial, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #f1f3f5",
  paddingBottom: 20,
  marginBottom: 24,
};

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const linkButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#111827",
  textDecoration: "none",
  display: "inline-block",
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = {
  margin: "6px 0 8px",
  fontSize: 32,
  color: "#111827",
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 18,
  backgroundColor: "#f9fafb",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  backgroundColor: "#fff",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  color: "#4b5563",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f5f9",
  color: "#111827",
  fontSize: 14,
  verticalAlign: "top",
};

const errorBox: CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecdd3",
  color: "#b91c1c",
  padding: 12,
  borderRadius: 8,
  margin: "12px 0",
};

const okBox: CSSProperties = {
  background: "#ecfeff",
  border: "1px solid #bae6fd",
  color: "#0369a1",
  padding: 12,
  borderRadius: 8,
  margin: "12px 0",
};

const gridCols2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 700,
};
