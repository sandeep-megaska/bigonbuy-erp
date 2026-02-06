import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { FormEvent } from "react";
import { fetchEmployeeSession } from "../../../lib/erp/employeeSession";

const cardStyle = {
  maxWidth: 460,
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

export default function EmployeeChangePasswordPage() {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await fetchEmployeeSession();
      if (!active) return;
      if (!session) {
        router.replace("/erp/employee/login");
        return;
      }
      if (!session.mustResetPassword) {
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

    if (!oldPassword || !newPassword) {
      setError("Please enter your current and new password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/hr/employee/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Unable to change password");
      }

      router.replace("/erp/employee");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to change password";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "24px" }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>Employee Portal</div>
        <h1 style={{ margin: "6px 0 12px", fontSize: 26 }}>Reset your password</h1>
        <p style={{ marginBottom: 20, color: "#4b5563" }}>
          Please update your temporary password before continuing.
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
          <label style={labelStyle} htmlFor="oldPassword">
            Current Password
          </label>
          <input
            id="oldPassword"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
          />

          <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="newPassword">
            New Password
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
            autoComplete="new-password"
          />

          <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="confirmPassword">
            Confirm New Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
            autoComplete="new-password"
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
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
