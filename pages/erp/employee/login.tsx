import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { FormEvent } from "react";

const cardStyle = {
  maxWidth: 420,
  margin: "80px auto",
  padding: 24,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
  background: "#fff",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const labelStyle = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  color: "#111827",
};

export default function EmployeeLoginPage() {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/erp/employee/me");
      if (!active) return;
      if (res.ok) {
        router.replace("/erp/employee");
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/erp/employee/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_code: employeeCode, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Unable to sign in");
      }

      router.replace("/erp/employee");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to sign in";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "24px" }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>Employee Portal</div>
        <h1 style={{ margin: "6px 0 16px", fontSize: 28 }}>Sign in</h1>
        <p style={{ marginBottom: 20, color: "#4b5563" }}>
          Use your employee code and password to access self-service tools.
        </p>

        {error ? (
          <div
            style={{
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              padding: 12,
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          <label style={labelStyle} htmlFor="employeeCode">
            Employee Code
          </label>
          <input
            id="employeeCode"
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            style={inputStyle}
            autoComplete="username"
            placeholder="EMP0001"
          />

          <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 20,
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: loading ? "#94a3b8" : "#2563eb",
              color: "#fff",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
