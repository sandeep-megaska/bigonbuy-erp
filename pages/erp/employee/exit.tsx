import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { fetchEmployeeSession, type EmployeeSessionContext } from "../../../lib/erp/employeeSession";

type ExitMeta = { id: string; name: string };

type ExitRequest = {
  id: string;
  status: string;
  initiated_on: string;
  last_working_day: string;
  notice_period_days: number | null;
  notice_waived: boolean;
  notes: string | null;
  exit_type?: { name?: string | null } | null;
  exit_reason?: { name?: string | null } | null;
};

type FormState = {
  exit_type_id: string;
  exit_reason_id: string;
  last_working_day: string;
  notice_period_days: string;
  notice_waived: boolean;
  notes: string;
};

export default function EmployeeExitPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<EmployeeSessionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [exitTypes, setExitTypes] = useState<ExitMeta[]>([]);
  const [exitReasons, setExitReasons] = useState<ExitMeta[]>([]);
  const [exitRequests, setExitRequests] = useState<ExitRequest[]>([]);
  const [form, setForm] = useState<FormState>({
    exit_type_id: "",
    exit_reason_id: "",
    last_working_day: "",
    notice_period_days: "",
    notice_waived: false,
    notes: "",
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await fetchEmployeeSession();
      if (!active) return;
      if (!session) {
        router.replace("/erp/employee/login");
        return;
      }
      if (session.mustResetPassword) {
        router.replace("/erp/employee/change-password");
        return;
      }
      setCtx(session);
      await Promise.all([loadMeta(), loadExits()]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadMeta() {
    const res = await fetch("/api/hr/employee/exits/meta");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || "Unable to load exit metadata.");
      return;
    }
    setExitTypes(data.types || []);
    setExitReasons(data.reasons || []);
    if (!form.exit_type_id && data.types?.length) {
      setForm((prev) => ({ ...prev, exit_type_id: data.types[0].id }));
    }
  }

  async function loadExits() {
    const res = await fetch("/api/hr/employee/exits/list");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || "Unable to load exit requests.");
      return;
    }
    setExitRequests(data.exits || []);
  }

  const hasActiveExit = useMemo(() => {
    return exitRequests.some((req) => ["draft", "submitted", "approved"].includes(req.status));
  }, [exitRequests]);

  async function handleSubmit() {
    setError("");
    setSuccess("");
    if (!form.exit_type_id) {
      setError("Exit type is required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/hr/employee/exits/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exit_type_id: form.exit_type_id,
        exit_reason_id: form.exit_reason_id || null,
        last_working_day: form.last_working_day || null,
        notice_period_days: form.notice_period_days ? Number(form.notice_period_days) : null,
        notice_waived: form.notice_waived,
        notes: form.notes || null,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || "Unable to submit exit request.");
      setSaving(false);
      return;
    }
    setSuccess("Exit request submitted.");
    setForm((prev) => ({ ...prev, notes: "" }));
    setSaving(false);
    await loadExits();
  }

  async function handleLogout() {
    await fetch("/api/hr/employee/auth/logout", { method: "POST" });
    router.replace("/erp/employee/login");
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Loading exit requests…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>Employee · Exit</div>
          <h1 style={{ margin: "6px 0", fontSize: 28 }}>Exit / Resignation</h1>
          <div style={{ color: "#6b7280" }}>{ctx?.displayName} · {ctx?.employeeCode}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/erp/employee">← Back to Portal Home</Link>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: "1px solid #d1d5db",
              background: "#fff",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 12, color: "#b91c1c" }}>{error}</div>
      ) : null}
      {success ? (
        <div style={{ marginTop: 12, color: "#065f46" }}>{success}</div>
      ) : null}

      <div
        style={{
          marginTop: 20,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Submit an exit request</h2>
        {hasActiveExit ? (
          <p style={{ color: "#6b7280" }}>
            You already have an active exit request. HR will review it before further action.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
            <label>
              Exit Type
              <select
                value={form.exit_type_id}
                onChange={(e) => setForm((prev) => ({ ...prev, exit_type_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Select exit type</option>
                {exitTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exit Reason (optional)
              <select
                value={form.exit_reason_id}
                onChange={(e) => setForm((prev) => ({ ...prev, exit_reason_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Select reason</option>
                {exitReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Last Working Day
              <input
                type="date"
                value={form.last_working_day}
                onChange={(e) => setForm((prev) => ({ ...prev, last_working_day: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label>
              Notice Period Days
              <input
                type="number"
                value={form.notice_period_days}
                onChange={(e) => setForm((prev) => ({ ...prev, notice_period_days: e.target.value }))}
                style={inputStyle}
                min={0}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.notice_waived}
                onChange={(e) => setForm((prev) => ({ ...prev, notice_waived: e.target.checked }))}
              />
              Notice waived
            </label>
            <label>
              Notes
              <textarea
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: "12px",
                borderRadius: 10,
                border: "none",
                background: saving ? "#94a3b8" : "#2563eb",
                color: "#fff",
                fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Submitting…" : "Submit exit request"}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 20,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          padding: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>My exit requests</h2>
        {exitRequests.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No exit requests yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {exitRequests.map((req) => (
              <div key={req.id} style={exitCardStyle}>
                <div style={{ fontWeight: 700 }}>{req.exit_type?.name || "Exit request"}</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>
                  Status: {req.status} · Initiated: {req.initiated_on}
                </div>
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  Last working day: {req.last_working_day || "—"}
                </div>
                {req.exit_reason?.name ? (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>Reason: {req.exit_reason.name}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  marginTop: 6,
} as const;

const exitCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
} as const;
