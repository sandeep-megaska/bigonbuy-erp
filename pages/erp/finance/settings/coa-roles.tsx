import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: { access_token?: string } | null;
  email: string | null;
  userId: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type ControlRoleRow = {
  role_key: string;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
};

const ROLE_LABELS: Record<string, string> = {
  bank_main: "Main Bank",
  vendor_payable: "Vendor Payable",
  vendor_advance: "Vendor Advances",
  tds_payable: "TDS Payable",
  input_gst_cgst: "Input GST (CGST)",
  input_gst_sgst: "Input GST (SGST)",
  input_gst_igst: "Input GST (IGST)",
  inventory_asset: "Inventory Asset",
  gateway_clearing: "Gateway Clearing",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  bank_main: "Primary bank clearing account for settlements.",
  vendor_payable: "Accounts payable control account for vendor bills.",
  vendor_advance: "Control account for vendor advances and prepayments.",
  tds_payable: "TDS liability account for vendor deductions.",
  input_gst_cgst: "Input CGST account for GST on purchases.",
  input_gst_sgst: "Input SGST account for GST on purchases.",
  input_gst_igst: "Input IGST account for GST on purchases.",
  inventory_asset: "Inventory asset account for GRN postings.",
  gateway_clearing: "Payment gateway clearing account (Razorpay).",
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

const hintStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const statusPillStyle = (active: boolean) => ({
  padding: "4px 10px",
  borderRadius: 999,
  background: active ? "#dcfce7" : "#fef9c3",
  color: active ? "#15803d" : "#92400e",
  fontSize: 12,
  fontWeight: 600,
});

const formatAccountLabel = (account: AccountOption | null) => {
  if (!account) return "";
  return `${account.code} · ${account.name}`;
};

const formatRoleLabel = (roleKey: string) =>
  ROLE_LABELS[roleKey] || roleKey.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());

export default function CoaControlRolesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roles, setRoles] = useState<ControlRoleRow[]>([]);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);

  const [selectionByRole, setSelectionByRole] = useState<Record<string, string>>({});

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const getAuthHeaders = (tokenOverride?: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = tokenOverride ?? ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadRoles = async () => {
    const { data, error: roleError } = await supabase.rpc("erp_fin_coa_control_roles_list");
    if (roleError) {
      setError(roleError.message || "Unable to load COA control roles.");
      return;
    }
    const rows = (data || []) as ControlRoleRow[];
    setRoles(rows);
    const selections: Record<string, string> = {};
    rows.forEach((row) => {
      selections[row.role_key] = row.account_id ?? "";
    });
    setSelectionByRole(selections);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context as CompanyContext);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadRoles();
      if (!active) return;
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      if (!active) return;
      const params = new URLSearchParams();
      if (accountQuery.trim()) params.set("q", accountQuery.trim());
      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`,
        {
          headers: getAuthHeaders(),
        }
      );
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load GL accounts.");
        return;
      }
      setAccountOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accountQuery, ctx?.session?.access_token]);

  const initialMapping = useMemo(() => {
    const mapping: Record<string, string> = {};
    roles.forEach((row) => {
      mapping[row.role_key] = row.account_id ?? "";
    });
    return mapping;
  }, [roles]);

  const handleSave = async () => {
    if (!canWrite) {
      setError("Only finance admins can update COA control roles.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updates = roles
        .map((row) => ({
          roleKey: row.role_key,
          accountId: selectionByRole[row.role_key] || "",
        }))
        .filter((row) => row.accountId && row.accountId !== initialMapping[row.roleKey]);

      if (updates.length === 0) {
        setNotice("No changes to save.");
        return;
      }

      for (const update of updates) {
        const { error: updateError } = await supabase.rpc("erp_fin_coa_control_role_set", {
          p_role: update.roleKey,
          p_account_id: update.accountId,
          p_is_control: true,
        });
        if (updateError) {
          throw updateError;
        }
      }

      await loadRoles();
      setNotice("COA control roles updated.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save COA control roles.";
      setError(message || "Unable to save COA control roles.");
    } finally {
      setSaving(false);
    }
  };

  const missingRoles = roles.filter((row) => !selectionByRole[row.role_key]);

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading COA control roles…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="COA Control Roles"
            description="Map control accounts to semantic finance roles."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Settings"
          title="COA Control Roles"
          description="Map chart of accounts to semantic control roles used by finance postings."
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <p style={{ marginTop: 0, color: "#4b5563", fontSize: 14, maxWidth: 520 }}>
              Assign existing ledger accounts to each control role. Posting flows will require these roles
              before they can be enabled.
            </p>
            <span style={statusPillStyle(missingRoles.length === 0)}>
              {missingRoles.length === 0 ? "All mapped" : "Needs setup"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Link href="/erp/finance/masters/gl-accounts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Open Chart of Accounts
            </Link>
          </div>

          <label style={labelStyle}>
            Search GL accounts
            <input
              style={inputStyle}
              value={accountQuery}
              onChange={(event) => setAccountQuery(event.target.value)}
              placeholder="Search accounts by code or name"
            />
            <span style={hintStyle}>Search results populate the dropdowns below.</span>
          </label>

          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            {roles.map((role) => {
              const selectedAccount = accountOptions.find((option) => option.id === selectionByRole[role.role_key]) ||
                (role.account_id
                  ? {
                      id: role.account_id,
                      code: role.account_code ?? "",
                      name: role.account_name ?? "",
                    }
                  : null);
              const roleOptions =
                selectedAccount && !accountOptions.find((option) => option.id === selectedAccount.id)
                  ? [selectedAccount, ...accountOptions]
                  : accountOptions;
              return (
                <label key={role.role_key} style={labelStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{formatRoleLabel(role.role_key)}</span>
                    <span style={statusPillStyle(Boolean(selectionByRole[role.role_key]))}>
                      {selectionByRole[role.role_key] ? "Mapped" : "Not mapped"}
                    </span>
                  </div>
                  <span style={hintStyle}>{ROLE_DESCRIPTIONS[role.role_key] || ""}</span>
                  <select
                    style={inputStyle}
                    value={selectionByRole[role.role_key] || ""}
                    onChange={(event) =>
                      setSelectionByRole((prev) => ({ ...prev, [role.role_key]: event.target.value }))
                    }
                  >
                    <option value="">Select account</option>
                    {roleOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.code} · {option.name}
                      </option>
                    ))}
                  </select>
                  <span style={hintStyle}>
                    {selectedAccount
                      ? `Selected: ${formatAccountLabel(selectedAccount)}`
                      : role.account_id
                        ? `ID: ${role.account_id}`
                        : "No account mapped"}
                  </span>
                </label>
              );
            })}
          </div>

          {missingRoles.length > 0 ? (
            <div style={{ marginTop: 12, color: "#92400e", fontSize: 13 }}>
              {missingRoles.length} role(s) are unmapped. Posting workflows will be blocked until they are set.
            </div>
          ) : null}
          {notice ? <div style={{ marginTop: 12, color: "#047857", fontSize: 13 }}>{notice}</div> : null}
          {error ? <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>{error}</div> : null}
        </div>
      </div>
    </ErpShell>
  );
}
