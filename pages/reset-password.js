import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setChecking(true);
      setErrMsg("");
      setOkMsg("");

      // Supabase client auto-detects recovery link params in URL and establishes session (if valid)
      const { data, error } = await supabase.auth.getSession();

      if (cancelled) return;

      if (error) {
        setHasSession(false);
        setChecking(false);
        setErrMsg(error.message);
        return;
      }

      const session = data?.session || null;
      setHasSession(!!session);
      setEmail(session?.user?.email || "");
      setChecking(false);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setErrMsg("");
    setOkMsg("");

    if (!pw1 || pw1.length < 8) {
      setErrMsg("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setErrMsg("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;

      setOkMsg("Password set successfully. You can now sign in using email + password.");
      setPw1("");
      setPw2("");
    } catch (e2) {
      setErrMsg(e2?.message || "Failed to set password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={container}>
      <div style={card}>
        <h1 style={{ margin: "0 0 6px", fontSize: 34 }}>Set your password</h1>
        <div style={{ opacity: 0.75, marginBottom: 16 }}>
          This page is used for first-time password setup and password reset.
        </div>

        {checking ? (
          <div>Checking link…</div>
        ) : !hasSession ? (
          <>
            <div style={errorBox}>
              This link is invalid or expired. Please request a new password setup/reset link from HR,
              or use “Forgot password” on the login page.
            </div>
            <div style={{ marginTop: 12 }}>
              <Link href="/">← Back to login</Link>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              Signed in as <b>{email || "employee"}</b>
            </div>

            {errMsg ? <div style={errorBox}>{errMsg}</div> : null}
            {okMsg ? <div style={okBox}>{okMsg}</div> : null}

            <form onSubmit={handleSetPassword} style={{ marginTop: 12 }}>
              <label style={label}>New password</label>
              <input
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                style={input}
                placeholder="Minimum 8 characters"
              />

              <label style={label}>Confirm password</label>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                style={input}
                placeholder="Re-enter password"
              />

              <button disabled={submitting} style={button}>
                {submitting ? "Saving…" : "Set Password"}
              </button>
            </form>

            <div style={{ marginTop: 12 }}>
              <Link href="/">← Back to login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const container = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  fontFamily: "system-ui",
  background: "#f9fafb",
};

const card = {
  width: "100%",
  maxWidth: 560,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 22,
  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
};

const label = { display: "block", fontWeight: 700, marginTop: 10, marginBottom: 6 };

const input = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const button = {
  width: "100%",
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const errorBox = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: 12,
  borderRadius: 10,
  whiteSpace: "pre-wrap",
};

const okBox = {
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
  color: "#065f46",
  padding: 12,
  borderRadius: 10,
  whiteSpace: "pre-wrap",
};
