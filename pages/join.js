import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function JoinPage() {
  const router = useRouter();
  const { token } = router.query;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (router.isReady) {
      setTokenReady(true);
    }
  }, [router.isReady]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Onboarding token missing.");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/public/complete-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to complete onboarding");
      }
      setSuccess(true);
    } catch (e) {
      setError(e?.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={containerStyle}>
      <h1 style={{ marginTop: 0 }}>Join Bigonbuy</h1>
      <p style={{ color: "#4b5563", marginTop: 6 }}>Set your login details to access your employee portal.</p>

      {!tokenReady ? (
        <div style={{ marginTop: 12 }}>Loading token…</div>
      ) : !token ? (
        <div style={errorStyle}>Join token is missing or invalid.</div>
      ) : success ? (
        <div style={successStyle}>
          <div style={{ fontWeight: 800 }}>Account created</div>
          <p style={{ margin: "6px 0 12px", color: "#065f46" }}>
            Your account is ready. Please log in to continue.
          </p>
          <button style={{ ...buttonStyle, backgroundColor: "#111827" }} onClick={() => router.replace("/")}>
            Go to Login
          </button>
        </div>
      ) : (
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

          <label style={labelStyle}>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            style={inputStyle}
            placeholder="••••••••"
          />

          <button type="submit" style={buttonStyle} disabled={submitting}>
            {submitting ? "Submitting…" : "Create Account"}
          </button>
        </form>
      )}

      {error ? <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p> : null}
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
  boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const formStyle = { display: "flex", flexDirection: "column", gap: 12, marginTop: 16 };
const labelStyle = { fontWeight: 600, fontSize: 14 };
const inputStyle = { padding: "10px 12px", fontSize: 16, borderRadius: 6, border: "1px solid #ccc" };
const buttonStyle = {
  padding: "12px 14px",
  backgroundColor: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 16,
};
const successStyle = {
  marginTop: 12,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #bbf7d0",
  background: "#ecfdf5",
  color: "#065f46",
};

const errorStyle = {
  marginTop: 12,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
};
