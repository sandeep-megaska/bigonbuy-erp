import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getSessionOrNull } from "../lib/erpContext";

export default function Home() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    getSessionOrNull().then((s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
      setError("");
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) setError(signInError.message);

    setSubmitting(false);
  };

  const handleSignOut = async () => {
    setError("");
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <p>Checking session...</p>
      </div>
    );
  }
const handleForgotPassword = async () => {
  setError("");
  if (!email) {
    setError("Enter your email first, then click Forgot password.");
    return;
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://erp.bigonbuy.com";

  const { error: fpErr } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${baseUrl}/reset-password`,
  });

  if (fpErr) {
    setError(fpErr.message);
    return;
  }

  setError("Password reset email sent. Check your inbox (and spam).");
};

  return (
    <div style={containerStyle}>
      {!session ? (
        <>
          <h1 style={{ marginBottom: 8 }}>Login to Bigonbuy ERP</h1>
          <p style={{ marginTop: 0, color: "#555" }}>Access the console with your Supabase credentials.</p>

          <form onSubmit={handleSubmit} style={formStyle}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              placeholder="you@example.com"
            />

            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
              placeholder="••••••••"
            />

            <button type="submit" style={buttonStyle} disabled={submitting}>
              {submitting ? "Signing in..." : "Sign In"}
            </button>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button type="button" onClick={handleForgotPassword} style={secondaryBtn}>
    Forgot / Set password
  </button>
  <Link href="/reset-password" style={{ marginTop: 8 }}>
    Have a link? Open reset page
  </Link>
</div>

          </form>

          {error ? <p style={{ color: "red", marginTop: 12 }}>{error}</p> : null}
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <p style={eyebrowStyle}>Console</p>
              <h1 style={{ margin: "6px 0" }}>Bigonbuy Console</h1>
              <p style={{ marginTop: 0, color: "#555" }}>Choose a module to manage your ERP data.</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, color: "#444" }}>
                Signed in as <strong>{session.user.email}</strong>
              </p>
              <button onClick={handleSignOut} style={{ ...buttonStyle, marginTop: 8, background: "#e11d48" }}>
                Sign Out
              </button>
            </div>
          </div>

          <ul style={{ lineHeight: 2, paddingLeft: 18, marginTop: 18 }}>
            <li>
              <Link href="/erp">/erp (ERP Home)</Link>
            </li>
            <li>
              <Link href="/me">/me (Employee Self-Service)</Link>
            </li>
            <li>
              <Link href="/erp/products">/erp/products</Link>
            </li>
            <li>
              <Link href="/erp/variants">/erp/variants</Link>
            </li>
            <li>
              <Link href="/erp/inventory">/erp/inventory</Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

const containerStyle = {
  maxWidth: 520,
  margin: "80px auto",
  padding: 24,
  border: "1px solid #ddd",
  borderRadius: 10,
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const formStyle = { display: "flex", flexDirection: "column", gap: 12, marginTop: 16 };
const labelStyle = { fontWeight: 600, fontSize: 14 };
const inputStyle = { padding: "10px 12px", fontSize: 16, borderRadius: 6, border: "1px solid #ccc" };
const buttonStyle = {
  padding: "12px 14px",
  backgroundColor: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 16,
};
const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};
const secondaryBtn = {
  padding: "10px 12px",
  backgroundColor: "#fff",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};
