import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NextPage } from "next";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

type CompanyUserRow = {
  user_id: string;
  email: string | null;
  role_key: string;
  created_at: string | null;
  updated_at: string | null;
};

type InvitePayload = {
  email: string;
  role_key: string;
  full_name?: string;
};

type ApiResponse<T> = { ok: true } & T;
type ApiError = { ok: false; error: string };

const CompanyUsersPage: NextPage = () => {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<CompanyUserRow[]>([]);
  const [listError, setListError] = useState<string>("");
  const [inviteError, setInviteError] = useState<string>("");
  const [inviteSuccess, setInviteSuccess] = useState<string>("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState<InvitePayload["role_key"]>("employee");
  const [fullName, setFullName] = useState("");

  const fetchUsers = useCallback(
    async (accessToken?: string) => {
      setListError("");
      const token =
        accessToken ||
        (await supabase.auth.getSession()).data?.session?.access_token ||
        null;

      if (!token) {
        setListError("Please sign in again.");
        return;
      }

      const res = await fetch("/api/company/company-users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as ApiResponse<{ users: CompanyUserRow[] }> | ApiError;

      if (!res.ok || !body.ok) {
        setUsers([]);
        setListError(body.ok ? "Unable to load company users" : body.error);
        return;
      }

      setUsers(body.users || []);
    },
    []
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const currentSession = data?.session ?? null;
      if (!currentSession) {
        router.replace("/erp/login");
        return;
      }

      setSession(currentSession);
      await fetchUsers(currentSession.access_token);
      if (!active) return;
      setLoading(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        router.replace("/erp/login");
      } else {
        setSession(nextSession);
      }
    });

    return () => {
      active = false;
      authListener?.subscription.unsubscribe();
    };
  }, [fetchUsers, router]);

  const handleInvite = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setInviteError("");
      setInviteSuccess("");
      setInviteBusy(true);

      try {
        const trimmedEmail = email.trim().toLowerCase();
        const trimmedFullName = fullName.trim();
        if (!trimmedEmail) {
          setInviteError("Email is required.");
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        const accessToken = data?.session?.access_token || null;
        if (error || !accessToken) {
          setInviteError("Please sign in again.");
          router.replace("/erp/login");
          return;
        }

        const payload: InvitePayload = {
          email: trimmedEmail,
          role_key: roleKey,
        };
        if (trimmedFullName) payload.full_name = trimmedFullName;

        const res = await fetch("/api/company/invite-user", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const body = (await res.json()) as ApiResponse<{ invited: unknown }> | ApiError;
        if (!res.ok || !body.ok) {
          setInviteError(body.ok ? "Failed to send invitation" : body.error);
          return;
        }

        setInviteSuccess("Invitation sent successfully. The user will receive an email to set their password.");
        setEmail("");
        setFullName("");
        await fetchUsers(accessToken);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send invitation";
        setInviteError(message);
      } finally {
        setInviteBusy(false);
      }
    },
    [email, fetchUsers, fullName, roleKey, router]
  );

  const handleRefresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token || null;
    if (!accessToken) {
      router.replace("/erp/login");
      return;
    }
    await fetchUsers(accessToken);
  }, [fetchUsers, router]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/erp/login");
  }, [router]);

  const signedInEmail = useMemo(() => session?.user?.email ?? "member", [session]);

  if (loading) {
    return <div style={containerStyle}>Loading company users…</div>;
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={titleStyle}>Company Users</h1>
          <p style={subtitleStyle}>Invite and manage ERP access for your team.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{signedInEmail}</strong>
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

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 12px" }}>Invite user</h2>
        {inviteError ? <div style={errorBox}>{inviteError}</div> : null}
        {inviteSuccess ? <div style={okBox}>{inviteSuccess}</div> : null}
        <form onSubmit={handleInvite} style={formGridStyle}>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              required
            />
          </div>
          <div>
            <label style={labelStyle}>Access Role</label>
            <select
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value as InvitePayload["role_key"])}
              style={selectStyle}
            >
              <option value="employee">Employee</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Full name (optional)</label>
            <input
              type="text"
              placeholder="Full name for invite email"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button type="submit" style={{ ...buttonStyle, backgroundColor: "#2563eb" }} disabled={inviteBusy}>
              {inviteBusy ? "Sending..." : "Invite user"}
            </button>
          </div>
        </form>
      </section>

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Current users</h2>
            <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
              Only Admin/HR/Owner can view this list.
            </p>
          </div>
          <button type="button" onClick={handleRefresh} style={{ ...buttonStyle, backgroundColor: "#111827" }}>
            Refresh
          </button>
        </div>
        {listError ? <p style={{ color: "#b91c1c" }}>{listError}</p> : null}
        {!listError && users.length === 0 ? (
          <p style={{ color: "#4b5563", margin: 0 }}>No users found.</p>
        ) : null}
        {!listError && users.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>User ID</th>
                  <th style={thStyle}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((m) => (
                  <tr key={m.user_id}>
                    <td style={tdStyle}>{m.email || "—"}</td>
                    <td style={tdStyle}>{m.role_key}</td>
                    <td style={tdStyle}>
                      <code>{m.user_id}</code>
                    </td>
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
};

export default CompanyUsersPage;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

const containerStyle: CSSProperties = {
  maxWidth: 960,
  margin: "80px auto",
  padding: "48px 56px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
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
  paddingBottom: 24,
  marginBottom: 32,
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
  marginBottom: 12,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  alignItems: "flex-end",
};

const labelStyle: CSSProperties = { display: "block", fontWeight: 700, marginBottom: 6 };

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
  backgroundColor: "#fff",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 8,
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
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

const errorBox: CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: 12,
  borderRadius: 10,
  whiteSpace: "pre-wrap",
  marginBottom: 10,
};

const okBox: CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
  color: "#065f46",
  padding: 12,
  borderRadius: 10,
  whiteSpace: "pre-wrap",
  marginBottom: 10,
};
