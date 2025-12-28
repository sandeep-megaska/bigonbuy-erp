import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function CompanyUsersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("employee");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (!isHr(context.roleKey)) {
        setError("You are not authorized to manage company users.");
        setLoading(false);
        return;
      }

      await loadMembers();
      if (!active) return;
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadMembers = async () => {
    setMembersError("");
    const { data, error: fetchError } = await supabase
      .from("erp_company_users")
      .select("user_id, role_key, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setMembersError(fetchError.message || "Unable to load company users");
      setMembers([]);
      return;
    }

    setMembers(data || []);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteMessage("");
    setInviteError("");
    setInviteBusy(true);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !roleKey) {
      setInviteError("Email and role are required");
      setInviteBusy(false);
      return;
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error("Please sign in again");
      }

      const res = await fetch("/api/company/invite-user", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: normalizedEmail, role_key: roleKey }),
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Failed to invite user");
      }

      setInviteMessage("Invitation sent and password setup link dispatched.");
      setEmail("");
      await loadMembers();
    } catch (err) {
      setInviteError(err?.message || "Failed to send invitation");
    } finally {
      setInviteBusy(false);
    }
  };

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
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!isHr(ctx.roleKey)) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Company Users</h1>
        <p style={{ color: "#b91c1c" }}>{error || "You are not authorized to manage company users."}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to ERP Home</Link>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={titleStyle}>Company Users</h1>
          <p style={subtitleStyle}>Invite and manage user access for the ERP.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || "member"}</strong></p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to ERP Home</Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 12px" }}>Invite user</h2>
        <form onSubmit={handleInvite} style={{ display: "grid", gridTemplateColumns: "1fr 200px auto", gap: 12, alignItems: "center" }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            required
          />
          <select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} style={selectStyle}>
            <option value="employee">Employee</option>
            <option value="hr">HR</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" style={{ ...buttonStyle, backgroundColor: "#2563eb" }} disabled={inviteBusy}>
            {inviteBusy ? "Sending..." : "Invite & Send Password Setup"}
          </button>
        </form>
        {inviteMessage ? <p style={{ color: "#16a34a", marginTop: 10 }}>{inviteMessage}</p> : null}
        {inviteError ? <p style={{ color: "#b91c1c", marginTop: 10 }}>{inviteError}</p> : null}
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Current users</h2>
          <button type="button" onClick={loadMembers} style={{ ...buttonStyle, backgroundColor: "#111827" }}>Refresh</button>
        </div>
        {membersError ? <p style={{ color: "#b91c1c" }}>{membersError}</p> : null}
        {!membersError && members.length === 0 ? (
          <p style={{ color: "#4b5563", margin: 0 }}>No users found.</p>
        ) : null}
        {!membersError && members.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>User ID</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td style={tdStyle}><code>{m.user_id}</code></td>
                    <td style={tdStyle}>{m.role_key}</td>
                    <td style={tdStyle}>{formatDate(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

const containerStyle = {
  maxWidth: 960,
  margin: "80px auto",
  padding: "48px 56px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #f1f3f5",
  paddingBottom: 24,
  marginBottom: 32,
};

const buttonStyle = {
  padding: "12px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
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
  fontSize: 32,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 18,
  backgroundColor: "#f9fafb",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
  marginBottom: 12,
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
};

const selectStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
  backgroundColor: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 8,
};

const thStyle = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  color: "#4b5563",
  fontWeight: 600,
};

const tdStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};
