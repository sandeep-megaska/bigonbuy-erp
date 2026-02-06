import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
} from "../../../../components/erp/uiStyles";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";

type LoanPostingForm = {
  loan_principal_account_id?: string;
  interest_expense_account_id?: string;
  bank_account_id?: string;
};

const labelStyle = { display: "grid", gap: 6, fontSize: 13, color: "#374151" } as const;

export default function LoanPostingSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoanPostingForm>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const configReady = useMemo(
    () =>
      Boolean(
        form.loan_principal_account_id && form.interest_expense_account_id && form.bank_account_id
      ),
    [form]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await requireAuthRedirectHome(router as any);
        if (!session || !active) return;
        const res = await fetch("/api/erp/finance/loan-posting-config", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || "Failed to load loan posting config.");
        }
        if (!active) return;
        setForm(json?.data || {});
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load loan posting config.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const session = await requireAuthRedirectHome(router as any);
      if (!session) return;
      const res = await fetch("/api/erp/finance/loan-posting-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to save loan posting config.");
      }
      setNotice("Loan posting config saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save loan posting config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Settings"
          title="Loan Posting"
          description="Configure account mappings used for loan posting entries."
          rightActions={
            <button
              type="button"
              style={{
                ...secondaryButtonStyle,
                backgroundColor: "#111827",
                color: "#fff",
                borderColor: "transparent",
                opacity: saving ? 0.7 : 1,
              }}
              onClick={save}
              disabled={saving || loading}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          }
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Link href="/erp/finance/settings" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
            Back to Finance Settings
          </Link>
          <Link
            href="/erp/finance/masters/gl-accounts"
            style={{ ...secondaryButtonStyle, textDecoration: "none" }}
          >
            Open Chart of Accounts
          </Link>
        </div>

        {error ? <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div> : null}

        <div style={{ ...cardStyle, marginTop: 0, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: configReady ? "#15803d" : "#92400e", fontWeight: 600 }}>
            {configReady ? "Configured" : "Needs setup"}
          </div>
          {loading ? (
            <p style={{ margin: 0, color: "#6b7280" }}>Loading loan posting settings…</p>
          ) : (
            <>
              <label style={labelStyle}>
                Loan Principal Account ID
                <input
                  style={inputStyle}
                  value={form.loan_principal_account_id || ""}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, loan_principal_account_id: e.target.value }))
                  }
                />
              </label>
              <label style={labelStyle}>
                Interest Expense Account ID
                <input
                  style={inputStyle}
                  value={form.interest_expense_account_id || ""}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, interest_expense_account_id: e.target.value }))
                  }
                />
              </label>
              <label style={labelStyle}>
                Bank Account ID
                <input
                  style={inputStyle}
                  value={form.bank_account_id || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, bank_account_id: e.target.value }))}
                />
              </label>
            </>
          )}
          {notice ? <p style={{ margin: 0, color: "#047857" }}>{notice}</p> : null}
        </div>
      </div>
    </ErpShell>
  );
}
