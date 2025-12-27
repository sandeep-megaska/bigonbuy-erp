import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function ResetPasswordPage() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      if (sessionError) {
        setError(sessionError.message);
      }

      setSession(data?.session ?? null);
      setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSession(newSession);
        setError("");
        setLoading(false);
      }
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!session) {
      setError("Reset link is invalid or expired. Request a new one from the login page.");
      return;
    }

    if (!password) {
      setError("Enter a new password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setUpdating(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setUpdating(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setSuccess("Password updated. You can now log in with your email and new password.");
  };

  return (
    <div style={containerStyle}>
      <h1 style={{ marginTop: 0 }}>Reset your password</h1>
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        Use the link you received via email to set a new password. Do not close this tab until you finish.
      </p>

      {loading ? (
        <p>Checking your reset link…</p>
      ) : !session ? (
        <div style={alertStyle}>
          <p style={{ margin: 0, fontWeight: 700 }}>This reset link is invalid or has expired.</p>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
            Request a new password email from the login page.
          </p>
          <div style={{ marginTop: 10 }}>
            <Link href="/" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 700 }}>
              Go to login
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <label style={labelStyle}>
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="Enter new password"
              required
            />
          </label>

          <label style={labelStyle}>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              placeholder="Confirm password"
              required
            />
          </label>

          <button type="submit" style={buttonStyle} disabled={updating}>
            {updating ? "Updating…" : "Update password"}
          </button>
        </form>
      )}

      {error ? (
        <div style={{ ...alertStyle, marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
          {error}
        </div>
      ) : null}

      {success ? (
        <div style={{ ...alertStyle, marginTop: 12, background: "#ecfdf5", border: "1px solid #bbf7d0", color: "#065f46" }}>
          {success}
          <div style={{ marginTop: 8 }}>
            <Link href="/" style={{ color: "#2563eb", fontWeight: 700 }}>
              Return to login
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle = {
  maxWidth: 480,
  margin: "80px auto",
  padding: 24,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
  backgroundColor: "#fff",
};

const labelStyle = {
  fontWeight: 700,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  color: "#111827",
};

const inputStyle = {
  padding: "10px 12px",
  fontSize: 16,
  borderRadius: 8,
  border: "1px solid #d1d5db",
};

const buttonStyle = {
  padding: "12px 14px",
  backgroundColor: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 16,
  marginTop: 4,
};

const alertStyle = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
};
