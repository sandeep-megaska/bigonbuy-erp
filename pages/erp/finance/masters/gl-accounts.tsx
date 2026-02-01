import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { apiFetch, apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, getSessionOrNull, requireAuthRedirectHome } from "../../../../lib/erpContext";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expense",
  equity: "Equity",
};

const NORMAL_BALANCE_BY_TYPE: Record<string, "debit" | "credit"> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  income: "credit",
  equity: "credit",
};

type GlAccount = {
  id: string;
  code: string;
  name: string;
  account_type: keyof typeof ACCOUNT_TYPE_LABELS;
  normal_balance: "debit" | "credit";
  is_active: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type ModalState = {
  open: boolean;
  account: {
    id: string | null;
    code: string;
    name: string;
    account_type: keyof typeof ACCOUNT_TYPE_LABELS;
    is_active: boolean;
  };
};

const emptyAccount = {
  id: null,
  code: "",
  name: "",
  account_type: "expense" as const,
  is_active: true,
};

export default function GlAccountsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalState, setModalState] = useState<ModalState>({ open: false, account: emptyAccount });

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
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const getAuthHeaders = async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token ?? (await getSessionOrNull())?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadAccounts = async () => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      setError("Please sign in again.");
      setIsLoadingData(false);
      return;
    }
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (includeInactive) params.set("include_inactive", "true");

    try {
      const payload = await apiGet<{ data?: GlAccount[] }>(`/api/finance/gl-accounts?${params.toString()}`, {
        headers,
      });
      setAccounts((payload?.data || []) as GlAccount[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load GL accounts.";
      setError(message);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadAccounts();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, includeInactive]);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    await loadAccounts();
  };

  const openModal = (account?: GlAccount) => {
    if (!canWrite) {
      setToast({ type: "error", message: "Only finance admins can update chart of accounts." });
      return;
    }

    setModalState({
      open: true,
      account: account
        ? {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.account_type,
            is_active: account.is_active,
          }
        : { ...emptyAccount },
    });
  };

  const closeModal = () => {
    setModalState({ open: false, account: emptyAccount });
  };

  const handleSave = async () => {
    if (!canWrite) return;
    const payload = {
      id: modalState.account.id ?? undefined,
      code: modalState.account.code.trim(),
      name: modalState.account.name.trim(),
      account_type: modalState.account.account_type,
      is_active: modalState.account.is_active,
    };

    if (!payload.code || !payload.name) {
      setToast({ type: "error", message: "Code and name are required." });
      return;
    }

    setIsSaving(true);
    setToast(null);

    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        setToast({ type: "error", message: "Please sign in again." });
        return;
      }
      await apiPost("/api/finance/gl-accounts/upsert", payload, { headers });
      setToast({ type: "success", message: "Account saved." });
      closeModal();
      await loadAccounts();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save account.";
      setToast({ type: "error", message });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading chart of accounts…</div>
      </ErpShell>
    );
  }

  const handleDeactivate = async (event: MouseEvent, account: GlAccount) => {
    event.stopPropagation();
    if (!canWrite) {
      setToast({ type: "error", message: "Only finance admins can update chart of accounts." });
      return;
    }

    if (!account.is_active) {
      await handleReactivate(account);
      return;
    }

    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      setToast({ type: "error", message: "Please sign in again." });
      return;
    }
    const response = await apiFetch(`/api/finance/gl-accounts/${account.id}/deactivate`, {
      method: "POST",
      headers,
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setToast({ type: "error", message: "Please sign in again." });
      } else {
        setToast({ type: "error", message: data?.error || "Failed to deactivate account." });
      }
      return;
    }

    setToast({ type: "success", message: "Account deactivated." });
    await loadAccounts();
  };

  const handleReactivate = async (account: GlAccount) => {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      setToast({ type: "error", message: "Please sign in again." });
      return;
    }
    const response = await apiFetch("/api/finance/gl-accounts/upsert", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: account.id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        is_active: true,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setToast({ type: "error", message: "Please sign in again." });
      } else {
        setToast({ type: "error", message: data?.error || "Failed to reactivate account." });
      }
      return;
    }

    setToast({ type: "success", message: "Account reactivated." });
    await loadAccounts();
  };

  const handleCopy = async (event: MouseEvent, value: string) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setToast({ type: "success", message: "UUID copied to clipboard." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy UUID.";
      setToast({ type: "error", message });
    }
  };

  const handleSeed = async () => {
    if (!canWrite) return;
    setToast(null);

    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      setToast({ type: "error", message: "Please sign in again." });
      return;
    }
    const response = await apiFetch("/api/finance/gl-accounts/seed-minimal", {
      method: "POST",
      headers,
    });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setToast({ type: "error", message: "Please sign in again." });
      } else {
        setToast({ type: "error", message: data?.error || "Failed to seed accounts." });
      }
      return;
    }

    const inserted = data?.data?.inserted ?? 0;
    setToast({ type: "success", message: `Seeded ${inserted} account(s).` });
    await loadAccounts();
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading chart of accounts…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Chart of Accounts"
            description="Maintain your company chart of accounts."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Masters"
          title="Chart of Accounts"
          description="Maintain ledger accounts used by payroll posting and finance workflows."
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to Finance
              </Link>
              <button
                type="button"
                onClick={() => openModal()}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: canWrite ? "#111827" : "#9ca3af",
                  borderColor: canWrite ? "#111827" : "#9ca3af",
                  cursor: canWrite ? "pointer" : "not-allowed",
                }}
                disabled={!canWrite}
              >
                Add Account
              </button>
            </div>
          }
        />

        {error ? (
          <div
            style={{
              ...cardStyle,
              borderColor: "#fecaca",
              color: "#b91c1c",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <span>{error}</span>
            <button type="button" style={secondaryButtonStyle} onClick={loadAccounts} disabled={isLoadingData}>
              Retry
            </button>
          </div>
        ) : null}
        {toast ? (
          <div
            style={{
              ...cardStyle,
              borderColor: toast.type === "success" ? "#bbf7d0" : "#fecaca",
              color: toast.type === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {toast.message}
          </div>
        ) : null}

        <form
          onSubmit={handleSearch}
          style={{
            ...cardStyle,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <label style={filterLabelStyle}>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by code or name"
              style={{ ...inputStyle, minWidth: 220 }}
            />
          </label>
          <label style={{ ...filterLabelStyle, flexDirection: "row", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            Include inactive
          </label>
          <button type="submit" style={secondaryButtonStyle} disabled={isLoadingData}>
            {isLoadingData ? "Loading…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={handleSeed}
            style={{ ...secondaryButtonStyle, marginLeft: "auto" }}
            disabled={!canWrite}
          >
            Seed minimal accounts
          </button>
        </form>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={tableHeaderCellStyle}>Code</th>
              <th style={tableHeaderCellStyle}>Name</th>
              <th style={tableHeaderCellStyle}>Type</th>
              <th style={tableHeaderCellStyle}>Normal</th>
              <th style={tableHeaderCellStyle}>Active</th>
              <th style={tableHeaderCellStyle}>UUID</th>
              <th style={tableHeaderCellStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td style={tableCellStyle} colSpan={7}>
                  {isLoadingData ? "Loading accounts…" : "No accounts found."}
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr
                  key={account.id}
                  onClick={() => openModal(account)}
                  style={{ cursor: canWrite ? "pointer" : "default" }}
                >
                  <td style={tableCellStyle}>{account.code}</td>
                  <td style={tableCellStyle}>{account.name}</td>
                  <td style={tableCellStyle}>{ACCOUNT_TYPE_LABELS[account.account_type]}</td>
                  <td style={tableCellStyle}>{account.normal_balance}</td>
                  <td style={tableCellStyle}>
                    <span
                      style={{
                        ...badgeStyle,
                        backgroundColor: account.is_active ? "#dcfce7" : "#fee2e2",
                        color: account.is_active ? "#166534" : "#991b1b",
                      }}
                    >
                      {account.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={tableCellStyle}>
                    <button
                      type="button"
                      onClick={(event) => handleCopy(event, account.id)}
                      style={secondaryButtonStyle}
                    >
                      Copy UUID
                    </button>
                  </td>
                  <td style={tableCellStyle}>
                    <button
                      type="button"
                      onClick={(event) => handleDeactivate(event, account)}
                      style={secondaryButtonStyle}
                      disabled={!canWrite}
                    >
                      {account.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalState.open ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={modalCardStyle}>
            <h2 style={{ marginTop: 0 }}>
              {modalState.account.id ? "Edit Account" : "Add Account"}
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={labelStyle}>
                Code
                <input
                  style={inputStyle}
                  value={modalState.account.code}
                  onChange={(event) =>
                    setModalState((prev) => ({
                      ...prev,
                      account: { ...prev.account, code: event.target.value },
                    }))
                  }
                  placeholder="e.g. 5001"
                />
              </label>
              <label style={labelStyle}>
                Name
                <input
                  style={inputStyle}
                  value={modalState.account.name}
                  onChange={(event) =>
                    setModalState((prev) => ({
                      ...prev,
                      account: { ...prev.account, name: event.target.value },
                    }))
                  }
                  placeholder="e.g. Salary Expense"
                />
              </label>
              <label style={labelStyle}>
                Account Type
                <select
                  style={inputStyle}
                  value={modalState.account.account_type}
                  onChange={(event) =>
                    setModalState((prev) => ({
                      ...prev,
                      account: {
                        ...prev.account,
                        account_type: event.target.value as GlAccount["account_type"],
                      },
                    }))
                  }
                >
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={labelStyle}>
                Normal Balance
                <div style={{ fontSize: 14, color: "#111827" }}>
                  {NORMAL_BALANCE_BY_TYPE[modalState.account.account_type]}
                </div>
              </div>
              <label style={labelStyle}>
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={modalState.account.is_active}
                  onChange={(event) =>
                    setModalState((prev) => ({
                      ...prev,
                      account: { ...prev.account, is_active: event.target.checked },
                    }))
                  }
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" onClick={closeModal} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  ...primaryButtonStyle,
                  backgroundColor: canWrite ? "#111827" : "#9ca3af",
                  borderColor: canWrite ? "#111827" : "#9ca3af",
                  cursor: canWrite ? "pointer" : "not-allowed",
                }}
                disabled={!canWrite || isSaving}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpShell>
  );
}

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const labelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const modalOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 40,
};

const modalCardStyle = {
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 24,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.2)",
};
