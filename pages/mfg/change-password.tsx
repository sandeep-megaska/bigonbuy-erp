import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";

export default function VendorChangePasswordPage() {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) return setError("Password must be at least 8 characters");
    if (newPassword !== confirmPassword) return setError("Passwords do not match");
    setLoading(true);
    setError("");
    const res = await fetch("/api/mfg/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok || !data.ok) return setError(data.error || "Unable to change password");

    const me = await fetch("/api/mfg/auth/me");
    const meData = await me.json();
    const code = meData?.session?.vendor_code || "";
    router.replace(`/mfg/v/${code}`);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f8fafc", padding: 24 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 20 }}>
        <h1>Reset Password</h1>
        {error ? <div style={{ color: "#991b1b", marginBottom: 12 }}>{error}</div> : null}
        <input type="password" placeholder="Current password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10 }} />
        <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10 }} />
        <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 10 }} />
        <button disabled={loading} style={{ width: "100%", padding: 10 }}>{loading ? "Saving..." : "Set password"}</button>
      </form>
    </div>
  );
}
