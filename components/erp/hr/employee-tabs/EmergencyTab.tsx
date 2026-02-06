import { useEffect, useMemo, useState } from "react";

type EmergencyRow = {
  id?: string;
  full_name?: string | null;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
};

type EmergencyForm = {
  full_name: string;
  relationship: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
};

const emptyForm: EmergencyForm = {
  full_name: "",
  relationship: "",
  phone: "",
  email: "",
  is_primary: true,
};

export default function EmergencyTab({ employeeId, accessToken, canManage }: Props) {
  const [form, setForm] = useState<EmergencyForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadEmergency();
  }, [hasAccess, employeeId]);

  function applyEmergency(data: EmergencyRow | null) {
    if (!data) {
      setForm(emptyForm);
      return;
    }
    setForm({
      full_name: data.full_name ?? "",
      relationship: data.relationship ?? "",
      phone: data.phone ?? "",
      email: data.email ?? "",
      is_primary: data.is_primary ?? true,
    });
  }

  async function loadEmergency() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/emergency`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load emergency contact.");
        return;
      }
      applyEmergency((data.emergency as EmergencyRow) ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load emergency contact.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!canManage) return;
    setSaving(true);
    setError("");
    setToast(null);

    if (!form.full_name.trim()) {
      setError("Contact name is required.");
      setSaving(false);
      return;
    }

    const payload = {
      full_name: form.full_name.trim(),
      relationship: form.relationship.trim() ? form.relationship.trim() : null,
      phone: form.phone.trim() ? form.phone.trim() : null,
      email: form.email.trim() ? form.email.trim() : null,
      is_primary: Boolean(form.is_primary),
    };

    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/emergency`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to save emergency contact.");
        return;
      }
      setToast({ type: "success", message: "Emergency contact saved." });
      await loadEmergency();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save emergency contact.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (!hasAccess) {
    return <div style={{ color: "#6b7280" }}>Missing employee access context.</div>;
  }

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h3 style={{ margin: 0 }}>Emergency Contact</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading emergency contact…</div> : null}

      <div style={cardStyle}>
        <div style={fieldGridStyle}>
          <label style={labelStyle}>
            Full Name
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
              style={inputStyle}
              placeholder="Contact name"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Relationship
            <input
              type="text"
              value={form.relationship}
              onChange={(e) => setForm((prev) => ({ ...prev, relationship: e.target.value }))}
              style={inputStyle}
              placeholder="Relationship"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Phone
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              style={inputStyle}
              placeholder="Phone number"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              style={inputStyle}
              placeholder="Email address"
              disabled={!canManage}
            />
          </label>
          <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
              disabled={!canManage}
            />
            Primary contact
          </label>
        </div>
        <div>
          <button type="button" onClick={handleSave} style={primaryButtonStyle} disabled={!canManage || saving}>
            {saving ? "Saving…" : "Save Emergency"}
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
  background: "#fff",
  display: "grid",
  gap: 12,
};

const fieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontWeight: 600 };

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
};

const primaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};

const successBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
};

const errorBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
};
