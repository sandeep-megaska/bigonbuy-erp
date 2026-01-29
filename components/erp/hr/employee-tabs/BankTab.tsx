import { useEffect, useMemo, useState } from "react";

type BankRow = {
  id?: string;
  bank_name?: string | null;
  branch_name?: string | null;
  account_holder_name?: string | null;
  account_number?: string | null;
  ifsc_code?: string | null;
  account_type?: string | null;
  is_primary?: boolean | null;
};

type BankForm = {
  bank_name: string;
  branch_name: string;
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  account_type: string;
  is_primary: boolean;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
};

const emptyForm: BankForm = {
  bank_name: "",
  branch_name: "",
  account_holder_name: "",
  account_number: "",
  ifsc_code: "",
  account_type: "",
  is_primary: true,
};

export default function BankTab({ employeeId, accessToken, canManage }: Props) {
  const [form, setForm] = useState<BankForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadBank();
  }, [hasAccess, employeeId]);

  function applyBank(data: BankRow | null) {
    if (!data) {
      setForm(emptyForm);
      return;
    }
    setForm({
      bank_name: data.bank_name ?? "",
      branch_name: data.branch_name ?? "",
      account_holder_name: data.account_holder_name ?? "",
      account_number: data.account_number ?? "",
      ifsc_code: data.ifsc_code ?? "",
      account_type: data.account_type ?? "",
      is_primary: data.is_primary ?? true,
    });
  }

  async function loadBank() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/bank`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to load bank details.");
        return;
      }
      applyBank((data.bank as BankRow) ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load bank details.";
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

    if (!form.bank_name.trim()) {
      setError("Bank name is required.");
      setSaving(false);
      return;
    }
    if (!form.account_number.trim()) {
      setError("Account number is required.");
      setSaving(false);
      return;
    }

    const payload = {
      bank_name: form.bank_name.trim(),
      branch_name: form.branch_name.trim() ? form.branch_name.trim() : null,
      account_holder_name: form.account_holder_name.trim() ? form.account_holder_name.trim() : null,
      account_number: form.account_number.trim(),
      ifsc_code: form.ifsc_code.trim() ? form.ifsc_code.trim() : null,
      account_type: form.account_type.trim() ? form.account_type.trim() : null,
      is_primary: Boolean(form.is_primary),
    };

    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/bank`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Failed to save bank details.");
        return;
      }
      setToast({ type: "success", message: "Bank details saved." });
      await loadBank();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save bank details.";
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
        <h3 style={{ margin: 0 }}>Bank</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading bank details…</div> : null}

      <div style={cardStyle}>
        <div style={fieldGridStyle}>
          <label style={labelStyle}>
            Bank Name
            <input
              type="text"
              value={form.bank_name}
              onChange={(e) => setForm((prev) => ({ ...prev, bank_name: e.target.value }))}
              style={inputStyle}
              placeholder="Bank name"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Branch
            <input
              type="text"
              value={form.branch_name}
              onChange={(e) => setForm((prev) => ({ ...prev, branch_name: e.target.value }))}
              style={inputStyle}
              placeholder="Branch name"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Account Holder
            <input
              type="text"
              value={form.account_holder_name}
              onChange={(e) => setForm((prev) => ({ ...prev, account_holder_name: e.target.value }))}
              style={inputStyle}
              placeholder="Account holder name"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Account Number
            <input
              type="text"
              value={form.account_number}
              onChange={(e) => setForm((prev) => ({ ...prev, account_number: e.target.value }))}
              style={inputStyle}
              placeholder="Account number"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            IFSC Code
            <input
              type="text"
              value={form.ifsc_code}
              onChange={(e) => setForm((prev) => ({ ...prev, ifsc_code: e.target.value }))}
              style={inputStyle}
              placeholder="IFSC code"
              disabled={!canManage}
            />
          </label>
          <label style={labelStyle}>
            Account Type
            <input
              type="text"
              value={form.account_type}
              onChange={(e) => setForm((prev) => ({ ...prev, account_type: e.target.value }))}
              style={inputStyle}
              placeholder="Savings / Current"
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
            Primary account
          </label>
        </div>
        <div>
          <button type="button" onClick={handleSave} style={primaryButtonStyle} disabled={!canManage || saving}>
            {saving ? "Saving…" : "Save Bank"}
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
