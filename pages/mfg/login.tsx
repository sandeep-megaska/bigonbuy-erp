import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";

export default function ManufacturerLoginPage() {
  const router = useRouter();
  const [vendorCode, setVendorCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/mfg/auth/me");
      if (!active || !res.ok) return;
      const data = await res.json();
      if (!data?.ok) return;
      if (data.session.kind === "vendor") {
        const code = data.session.vendor_code || "";
        router.replace(data.session.must_reset_password ? "/mfg/change-password" : `/mfg/v/${code}`);
        return;
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/mfg/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_code: vendorCode, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to sign in");
      if (data.session.must_reset_password) {
        router.replace("/mfg/change-password");
      } else {
        router.replace(`/mfg/v/${data.session.vendor_code}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 420, margin: "80px auto", border: "1px solid #e5e7eb", borderRadius: 16, background: "#fff", padding: 24 }}>
        <div style={{ fontSize: 12, color: "#6b7280", letterSpacing: 1 }}>Manufacturer Portal</div>
        <h1 style={{ marginTop: 8 }}>Vendor Sign in</h1>
        {error ? <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: 10, marginBottom: 12 }}>{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <label>Vendor Code</label>
          <input value={vendorCode} onChange={(e) => setVendorCode(e.target.value.toUpperCase())} style={{ width: "100%", padding: 10, marginTop: 6, border: "1px solid #d1d5db", borderRadius: 8 }} />
          <label style={{ marginTop: 12, display: "block" }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 6, border: "1px solid #d1d5db", borderRadius: 8 }} />
          <button disabled={loading} style={{ width: "100%", marginTop: 16, background: "#2563eb", border: "none", color: "#fff", padding: 12, borderRadius: 8 }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
