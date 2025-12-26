import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("bigonbuy1@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) router.replace("/erp");
      else setCheckingSession(false);
    });

    return () => {
      active = false;
    };
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) setError(signInError.message);
    else router.replace("/erp");

    setSubmitting(false);
  };

  if (checkingSession) {
    return (
      <div style={containerStyle}>
        <p>Checking session...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1>Login to Bigonbuy ERP</h1>

      <form onSubmit={handleSubmit} style={formStyle}>
        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />

        <button type="submit" style={buttonStyle} disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

const containerStyle = {
  maxWidth: 420,
  margin: "80px auto",
  padding: 24,
  border: "1px solid #ddd",
  borderRadius: 8,
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
};

const formStyle = { display: "flex", flexDirection: "column", gap: 12, marginTop: 16 };
const labelStyle = { fontWeight: 600, fontSize: 14 };
const inputStyle = { padding: "10px 12px", fontSize: 16, borderRadius: 6, border: "1px solid #ccc" };
const buttonStyle = { padding: "12px 14px", backgroundColor: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 16 };
