import { useEffect, useMemo, useState } from "react";

type ContactRow = {
  id?: string;
  contact_type?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: boolean | null;
};

type ContactForm = {
  email: string;
  phone: string;
  is_primary: boolean;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
  initialContacts?: ContactRow[];
  onContactsUpdated?: (contacts: ContactRow[]) => void;
};

const contactTypes = ["work_email", "mobile", "whatsapp"] as const;

type ContactType = (typeof contactTypes)[number];

const emptyForm: Record<ContactType, ContactForm> = {
  work_email: { email: "", phone: "", is_primary: false },
  mobile: { email: "", phone: "", is_primary: false },
  whatsapp: { email: "", phone: "", is_primary: false },
};

export default function ContactsTab({
  employeeId,
  accessToken,
  canManage,
  initialContacts,
  onContactsUpdated,
}: Props) {
  const [form, setForm] = useState<Record<ContactType, ContactForm>>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<ContactType, boolean>>({
    work_email: false,
    mobile: false,
    whatsapp: false,
  });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (initialContacts && initialContacts.length > 0) {
      applyContacts(initialContacts);
    }
  }, [initialContacts]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadContacts();
  }, [hasAccess, employeeId]);

  function applyContacts(contacts: ContactRow[]) {
    const byType = new Map<string, ContactRow>();
    contacts.forEach((contact) => {
      if (contact.contact_type) {
        byType.set(contact.contact_type, contact);
      }
    });

    setForm({
      work_email: {
        email: byType.get("work_email")?.email ?? "",
        phone: byType.get("work_email")?.phone ?? "",
        is_primary: Boolean(byType.get("work_email")?.is_primary),
      },
      mobile: {
        email: byType.get("mobile")?.email ?? "",
        phone: byType.get("mobile")?.phone ?? "",
        is_primary: Boolean(byType.get("mobile")?.is_primary),
      },
      whatsapp: {
        email: byType.get("whatsapp")?.email ?? "",
        phone: byType.get("whatsapp")?.phone ?? "",
        is_primary: Boolean(byType.get("whatsapp")?.is_primary),
      },
    });
  }

  async function loadContacts() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/contacts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load contacts.");
        return;
      }
      const rows = (data.contacts as ContactRow[]) || [];
      applyContacts(rows);
      onContactsUpdated?.(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load contacts.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(type: ContactType) {
    if (!canManage) return;
    setSaving((prev) => ({ ...prev, [type]: true }));
    setError("");
    setToast(null);

    const payload = {
      contact_type: type,
      email: form[type].email.trim() ? form[type].email.trim() : null,
      phone: form[type].phone.trim() ? form[type].phone.trim() : null,
      is_primary:
        type === "work_email" ? Boolean(form[type].email.trim()) : Boolean(form[type].is_primary),
    };

    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to save contact.");
        return;
      }
      setToast({ type: "success", message: "Contact saved." });
      await loadContacts();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save contact.";
      setError(message);
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }));
    }
  }

  if (!hasAccess) {
    return <div style={{ color: "#6b7280" }}>Missing employee access context.</div>;
  }

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h3 style={{ margin: 0 }}>Contacts</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading contacts…</div> : null}

      <div style={sectionGridStyle}>
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>Work Email</h4>
          <label style={labelStyle}>
            Email
            <input
              type="email"
              value={form.work_email.email}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  work_email: { ...prev.work_email, email: e.target.value },
                }))
              }
              style={inputStyle}
              placeholder="name@company.com"
              disabled={!canManage}
            />
          </label>
          <div style={helperStyle}>Work email is saved as primary when set.</div>
          <button
            type="button"
            onClick={() => handleSave("work_email")}
            style={primaryButtonStyle}
            disabled={!canManage || saving.work_email}
          >
            {saving.work_email ? "Saving…" : "Save Work Email"}
          </button>
        </div>

        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>Mobile</h4>
          <label style={labelStyle}>
            Phone
            <input
              type="tel"
              value={form.mobile.phone}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  mobile: { ...prev.mobile, phone: e.target.value },
                }))
              }
              style={inputStyle}
              placeholder="+1 555 123 4567"
              disabled={!canManage}
            />
          </label>
          <button
            type="button"
            onClick={() => handleSave("mobile")}
            style={primaryButtonStyle}
            disabled={!canManage || saving.mobile}
          >
            {saving.mobile ? "Saving…" : "Save Mobile"}
          </button>
        </div>

        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>WhatsApp</h4>
          <label style={labelStyle}>
            Phone
            <input
              type="tel"
              value={form.whatsapp.phone}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  whatsapp: { ...prev.whatsapp, phone: e.target.value },
                }))
              }
              style={inputStyle}
              placeholder="+1 555 987 6543"
              disabled={!canManage}
            />
          </label>
          <button
            type="button"
            onClick={() => handleSave("whatsapp")}
            style={primaryButtonStyle}
            disabled={!canManage || saving.whatsapp}
          >
            {saving.whatsapp ? "Saving…" : "Save WhatsApp"}
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

const sectionGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
  background: "#fff",
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
};

const cardTitleStyle = { margin: 0, fontSize: 16, color: "#111827" };

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontWeight: 600 };

const helperStyle = { color: "#6b7280", fontSize: 12 };

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
