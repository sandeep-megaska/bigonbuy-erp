import { useEffect, useMemo, useState } from "react";

type StatutoryRow = {
  id?: string;
  pan?: string | null;
  uan?: string | null;
  pf_number?: string | null;
  esic_number?: string | null;
  professional_tax_number?: string | null;
};

type StatutoryForm = {
  pan: string;
  uan: string;
  pf_number: string;
  esic_number: string;
  professional_tax_number: string;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
};

const emptyForm: StatutoryForm = {
  pan: "",
  uan: "",
  pf_number: "",
  esic_number: "",
  professional_tax_number: "",
};

export default function StatutoryTab({ employeeId, accessToken, canManage }: Props) {
  const [form, setForm] = useState<StatutoryForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadStatutory();
  }, [hasAccess, employeeId]);

  function applyStatutory(data: StatutoryRow | null) {
    if (!data) {
      setForm(emptyForm);
      return;
    }
    setForm({
      pan: data.pan ?? "",
      uan: data.uan ?? "",
      pf_number: data.pf_number ?? "",
      esic_number: data.esic_number ?? "",
      professional_tax_number: data.professional_tax_number ?? "",
    });
  }

  async function loadStatutory() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/statutory`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load statutory details.");
        return;
      }
      applyStatutory((data.statutory as StatutoryRow) ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load statutory details.";
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

    const payload = {
      pan: form.pan.trim() ? form.pan.trim() : null,
      uan: form.uan.trim() ? form.uan.trim() : null,
      pf_number: form.pf_number.trim() ? form.pf_number.trim() : null,
      esic_number: form.esic_number.trim() ? form.esic_number.trim() : null,
      professional_tax_number: form.professional_tax_number.trim() ? form.professional_tax_number.trim() : null,
    };

    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/statutory`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to save statutory details.");
        return;
      }
      setToast({ type: "success", message: "Statutory details saved." });
      await loadStatutory();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save statutory details.";
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
        <h3 style={{ margin: 0 }}>Statutory</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading statutory details…</div> : null}

      <div style={cardStyle}>
        <div style={fieldGridStyle}>
          <label style={labelStyle}>
            PAN
            <input
              type="text"
              value={form.pan}
              onChange={(e) => setForm((prev) => ({ ...prev, pan: e.target.value }))}
              style={inputStyle}
              placeholder="ABCDE1234F"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            UAN
            <input
              type="text"
              value={form.uan}
              onChange={(e) => setForm((prev) => ({ ...prev, uan: e.target.value }))}
              style={inputStyle}
              placeholder="12-digit UAN"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            PF Number
            <input
              type="text"
              value={form.pf_number}
              onChange={(e) => setForm((prev) => ({ ...prev, pf_number: e.target.value }))}
              style={inputStyle}
              placeholder="PF number"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            ESIC Number
            <input
              type="text"
              value={form.esic_number}
              onChange={(e) => setForm((prev) => ({ ...prev, esic_number: e.target.value }))}
              style={inputStyle}
              placeholder="ESIC number"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Professional Tax No.
            <input
              type="text"
              value={form.professional_tax_number}
              onChange={(e) => setForm((prev) => ({ ...prev, professional_tax_number: e.target.value }))}
              style={inputStyle}
              placeholder="Professional tax number"
              disabled={!canManage}
            />
          </label>
        </div>
        <div>
          <button type="button" onClick={handleSave} style={primaryButtonStyle} disabled={!canManage || saving}>
            {saving ? "Saving…" : "Save Statutory"}
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
