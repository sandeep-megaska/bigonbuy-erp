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
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: { access_token?: string } | null;
  email: string | null;
  userId: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
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

export default function SalesPostingSettingsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    salesRevenueAccountId: "",
    gstOutputAccountId: "",
    receivableAccountId: "",
  });

  const [salesQuery, setSalesQuery] = useState("");
  const [gstQuery, setGstQuery] = useState("");
  const [receivableQuery, setReceivableQuery] = useState("");

  const [salesOptions, setSalesOptions] = useState<AccountOption[]>([]);
  const [gstOptions, setGstOptions] = useState<AccountOption[]>([]);
  const [receivableOptions, setReceivableOptions] = useState<AccountOption[]>([]);

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await requireAuthRedirectHome(router);
        if (!session || !active) return;

        const context = await getCompanyContext(session);
        if (!active) return;

        setCtx(context as CompanyContext);
        if (!context.companyId) {
          setError(context.membershipError || "No active company membership found for this user.");
          return;
        }

        const token = (context as CompanyContext)?.session?.access_token ?? null;
        const payload = await apiGet<{ data?: Record<string, string | null> }>(
          "/api/erp/finance/sales-posting-config",
          {
            headers: getAuthHeaders(token),
          }
        );
        if (!active) return;

        if (payload?.data) {
          setForm({
            salesRevenueAccountId: payload.data.sales_revenue_account_id ?? "",
            gstOutputAccountId: payload.data.gst_output_account_id ?? "",
            receivableAccountId: payload.data.receivable_account_id ?? "",
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unable to load sales posting config.";
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
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
      try {
        const params = new URLSearchParams();
        if (salesQuery.trim()) params.set("q", salesQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/erp/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setSalesOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load sales revenue accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [salesQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      if (!active) return;
      try {
        const params = new URLSearchParams();
        if (gstQuery.trim()) params.set("q", gstQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/erp/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setGstOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load GST output accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gstQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      if (!active) return;
      try {
        const params = new URLSearchParams();
        if (receivableQuery.trim()) params.set("q", receivableQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/erp/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setReceivableOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load receivable accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [receivableQuery, ctx?.session?.access_token]);

  const handleSave = async () => {
    if (!canWrite) {
      setError("Only finance admins can update sales posting config.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/erp/finance/sales-posting-config",
        {
          salesRevenueAccountId: form.salesRevenueAccountId || null,
          gstOutputAccountId: form.gstOutputAccountId || null,
          receivableAccountId: form.receivableAccountId || null,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Sales posting config updated.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save sales posting config.";
      setError(message || "Unable to save sales posting config.");
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async () => {
    if (!ctx?.session?.access_token) {
      setError("Please sign in again.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await apiGet<{ data?: Record<string, string | null> }>(
        "/api/erp/finance/sales-posting-config",
        {
          headers: getAuthHeaders(),
        }
      );
      if (payload?.data) {
        setForm({
          salesRevenueAccountId: payload.data.sales_revenue_account_id ?? "",
          gstOutputAccountId: payload.data.gst_output_account_id ?? "",
          receivableAccountId: payload.data.receivable_account_id ?? "",
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load sales posting config.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const configReady = Boolean(
    form.salesRevenueAccountId && form.gstOutputAccountId && form.receivableAccountId
  );

  const selectedSales = salesOptions.find((option) => option.id === form.salesRevenueAccountId) || null;
  const selectedGst = gstOptions.find((option) => option.id === form.gstOutputAccountId) || null;
  const selectedReceivable =
    receivableOptions.find((option) => option.id === form.receivableAccountId) || null;

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading sales posting settings…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Sales Posting Settings"
            description="Set up accounts for Shopify revenue journals."
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
          title="Sales Posting"
          description="Configure accounts used for Shopify revenue journals."
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

        {error ? (
          <div
            style={{
              ...cardStyle,
              borderColor: "#fecaca",
              color: "#b91c1c",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>{error}</span>
            <button type="button" style={secondaryButtonStyle} onClick={handleRetry} disabled={loading}>
              Retry
            </button>
          </div>
        ) : null}

        <div style={{ ...cardStyle, marginTop: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ marginTop: 0, color: "#4b5563", fontSize: 14 }}>
              Map Shopify revenue, GST output, and receivable accounts for finance posting.
            </p>
            <span style={statusPillStyle(configReady)}>{configReady ? "Configured" : "Needs setup"}</span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Link href="/erp/finance/masters/gl-accounts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Open Chart of Accounts
            </Link>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <label style={labelStyle}>
              Sales Revenue Account
              <input
                style={inputStyle}
                value={salesQuery}
                onChange={(event) => setSalesQuery(event.target.value)}
                placeholder="Search revenue accounts by code or name"
              />
              <select
                style={inputStyle}
                value={form.salesRevenueAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, salesRevenueAccountId: event.target.value }))
                }
              >
                <option value="">Select sales revenue account</option>
                {salesOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedSales ? `Selected: ${formatAccountLabel(selectedSales)}` : `ID: ${form.salesRevenueAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              GST Output Account
              <input
                style={inputStyle}
                value={gstQuery}
                onChange={(event) => setGstQuery(event.target.value)}
                placeholder="Search GST output accounts by code or name"
              />
              <select
                style={inputStyle}
                value={form.gstOutputAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, gstOutputAccountId: event.target.value }))}
              >
                <option value="">Select GST output account</option>
                {gstOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedGst ? `Selected: ${formatAccountLabel(selectedGst)}` : `ID: ${form.gstOutputAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              Receivable Account
              <input
                style={inputStyle}
                value={receivableQuery}
                onChange={(event) => setReceivableQuery(event.target.value)}
                placeholder="Search receivable accounts by code or name"
              />
              <select
                style={inputStyle}
                value={form.receivableAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, receivableAccountId: event.target.value }))}
              >
                <option value="">Select receivable account</option>
                {receivableOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedReceivable
                  ? `Selected: ${formatAccountLabel(selectedReceivable)}`
                  : `ID: ${form.receivableAccountId}`}
              </span>
            </label>
          </div>

          {notice ? <div style={{ marginTop: 12, color: "#047857", fontSize: 13 }}>{notice}</div> : null}
        </div>
      </div>
    </ErpShell>
  );
}
