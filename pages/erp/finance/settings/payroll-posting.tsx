import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: unknown;
  email: string | null;
  userId: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const labelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const cardStyle = {
  marginTop: 16,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
};

export default function PayrollPostingSettingsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    salaryExpenseAccountId: "",
    payrollPayableAccountId: "",
    defaultCostCenterId: "",
  });

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      const { data, error: configError } = await supabase.rpc("erp_payroll_finance_posting_config_get");
      if (!active) return;

      if (configError) {
        setError(configError.message || "Unable to load payroll posting config.");
      } else if (data) {
        setForm({
          salaryExpenseAccountId: data.salary_expense_account_id ?? "",
          payrollPayableAccountId: data.payroll_payable_account_id ?? "",
          defaultCostCenterId: data.default_cost_center_id ?? "",
        });
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleSave = async () => {
    if (!canWrite) {
      setError("Only finance admins can update payroll posting config.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("erp_payroll_finance_posting_config_upsert", {
        p_salary_expense_account_id: form.salaryExpenseAccountId.trim() || null,
        p_payroll_payable_account_id: form.payrollPayableAccountId.trim() || null,
        p_default_cost_center_id: form.defaultCostCenterId.trim() || null,
      });
      if (saveError) throw saveError;
      setNotice("Payroll posting config updated.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save payroll posting config.";
      setError(message || "Unable to save payroll posting config.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading payroll posting settings…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Payroll Posting Settings"
            description="Set up accounts for payroll finance preview."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Settings"
          title="Payroll Posting"
          description="Configure accounts used in payroll finance posting previews."
          rightActions={
            <button
              type="button"
              onClick={handleSave}
              style={{
                ...secondaryButtonStyle,
                backgroundColor: canWrite ? "#111827" : "#9ca3af",
                color: "#fff",
                borderColor: "transparent",
                opacity: saving ? 0.7 : 1,
              }}
              disabled={!canWrite || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          }
        />

        <div style={{ ...cardStyle, marginTop: 0 }}>
          <p style={{ marginTop: 0, color: "#4b5563", fontSize: 14 }}>
            Enter the ledger account UUIDs to use for payroll finance previews. Posting is not enabled in
            Phase 1.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Link href="/erp/finance/masters/gl-accounts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Open Chart of Accounts
            </Link>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <label style={labelStyle}>
              Salary Expense Account ID
              <input
                style={inputStyle}
                value={form.salaryExpenseAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, salaryExpenseAccountId: event.target.value }))
                }
                placeholder="UUID for salary expense account"
              />
            </label>
            <label style={labelStyle}>
              Payroll Payable Account ID
              <input
                style={inputStyle}
                value={form.payrollPayableAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, payrollPayableAccountId: event.target.value }))
                }
                placeholder="UUID for payroll payable account"
              />
            </label>
            <label style={labelStyle}>
              Default Cost Center ID (optional)
              <input
                style={inputStyle}
                value={form.defaultCostCenterId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, defaultCostCenterId: event.target.value }))
                }
                placeholder="UUID for default cost center"
              />
            </label>
          </div>

          {notice ? (
            <div style={{ marginTop: 12, color: "#047857", fontSize: 13 }}>{notice}</div>
          ) : null}
          {error ? (
            <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>{error}</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
