import { useEffect, useMemo, useState } from "react";

type AddressRow = {
  id?: string;
  address_type?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  is_primary?: boolean | null;
};

type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_primary: boolean;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
};

const addressTypes = ["current", "permanent"] as const;

type AddressType = (typeof addressTypes)[number];

const emptyForm: Record<AddressType, AddressForm> = {
  current: {
    line1: "",
    line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    is_primary: false,
  },
  permanent: {
    line1: "",
    line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    is_primary: false,
  },
};

export default function AddressTab({ employeeId, accessToken, canManage }: Props) {
  const [form, setForm] = useState<Record<AddressType, AddressForm>>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<AddressType, boolean>>({
    current: false,
    permanent: false,
  });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadAddresses();
  }, [hasAccess, employeeId]);

  function applyAddresses(addresses: AddressRow[]) {
    const byType = new Map<string, AddressRow>();
    addresses.forEach((address) => {
      if (address.address_type) {
        byType.set(address.address_type, address);
      }
    });

    setForm({
      current: {
        line1: byType.get("current")?.line1 ?? "",
        line2: byType.get("current")?.line2 ?? "",
        city: byType.get("current")?.city ?? "",
        state: byType.get("current")?.state ?? "",
        postal_code: byType.get("current")?.postal_code ?? "",
        country: byType.get("current")?.country ?? "",
        is_primary: Boolean(byType.get("current")?.is_primary),
      },
      permanent: {
        line1: byType.get("permanent")?.line1 ?? "",
        line2: byType.get("permanent")?.line2 ?? "",
        city: byType.get("permanent")?.city ?? "",
        state: byType.get("permanent")?.state ?? "",
        postal_code: byType.get("permanent")?.postal_code ?? "",
        country: byType.get("permanent")?.country ?? "",
        is_primary: Boolean(byType.get("permanent")?.is_primary),
      },
    });
  }

  async function loadAddresses() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/addresses`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load addresses.");
        return;
      }
      const rows = (data.addresses as AddressRow[]) || [];
      applyAddresses(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load addresses.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(type: AddressType) {
    if (!canManage) return;
    setSaving((prev) => ({ ...prev, [type]: true }));
    setError("");
    setToast(null);

    const payload = {
      address_type: type,
      line1: form[type].line1.trim() ? form[type].line1.trim() : null,
      line2: form[type].line2.trim() ? form[type].line2.trim() : null,
      city: form[type].city.trim() ? form[type].city.trim() : null,
      state: form[type].state.trim() ? form[type].state.trim() : null,
      postal_code: form[type].postal_code.trim() ? form[type].postal_code.trim() : null,
      country: form[type].country.trim() ? form[type].country.trim() : null,
      is_primary: type === "current" ? Boolean(form[type].is_primary) : false,
    };

    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/addresses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to save address.");
        return;
      }
      setToast({ type: "success", message: "Address saved." });
      await loadAddresses();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save address.";
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
        <h3 style={{ margin: 0 }}>Addresses</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading addresses…</div> : null}

      <div style={sectionGridStyle}>
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>Current Address</h4>
          <div style={fieldGridStyle}>
            <label style={labelStyle}>
              Line 1
              <input
                type="text"
                value={form.current.line1}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, line1: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Line 2
              <input
                type="text"
                value={form.current.line2}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, line2: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              City
              <input
                type="text"
                value={form.current.city}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, city: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              State
              <input
                type="text"
                value={form.current.state}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, state: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Postal Code
              <input
                type="text"
                value={form.current.postal_code}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, postal_code: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Country
              <input
                type="text"
                value={form.current.country}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    current: { ...prev.current, country: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
          </div>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={form.current.is_primary}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  current: { ...prev.current, is_primary: e.target.checked },
                }))
              }
              disabled={!canManage}
            />
            Primary address
          </label>
          <button
            type="button"
            onClick={() => handleSave("current")}
            style={primaryButtonStyle}
            disabled={!canManage || saving.current}
          >
            {saving.current ? "Saving…" : "Save Current Address"}
          </button>
        </div>

        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>Permanent Address</h4>
          <div style={fieldGridStyle}>
            <label style={labelStyle}>
              Line 1
              <input
                type="text"
                value={form.permanent.line1}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, line1: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Line 2
              <input
                type="text"
                value={form.permanent.line2}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, line2: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              City
              <input
                type="text"
                value={form.permanent.city}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, city: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              State
              <input
                type="text"
                value={form.permanent.state}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, state: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Postal Code
              <input
                type="text"
                value={form.permanent.postal_code}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, postal_code: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <label style={labelStyle}>
              Country
              <input
                type="text"
                value={form.permanent.country}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permanent: { ...prev.permanent, country: e.target.value },
                  }))
                }
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => handleSave("permanent")}
            style={primaryButtonStyle}
            disabled={!canManage || saving.permanent}
          >
            {saving.permanent ? "Saving…" : "Save Permanent Address"}
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
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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

const fieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontWeight: 600 };

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  color: "#111827",
};

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
