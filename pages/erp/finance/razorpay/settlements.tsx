import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
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

type SettlementRow = {
  id: string;
  razorpay_settlement_id: string;
  settlement_utr: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  settled_at: string | null;
  fetched_at: string | null;
  posted_journal_id: string | null;
  posted_doc_no: string | null;
  post_status: string | null;
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

const hintStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const formatAccountLabel = (account: AccountOption | null) => {
  if (!account) return "";
  return `${account.code} · ${account.name}`;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB") : "—";

const formatAmount = (value: number | null) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

export default function RazorpaySettlementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");

  const [form, setForm] = useState({
    razorpayKeyId: "",
    razorpayKeySecret: "",
    razorpayClearingAccountId: "",
    bankAccountId: "",
    gatewayFeesAccountId: "",
    gstInputOnFeesAccountId: "",
    hasKeySecret: false,
  });

  const [clearingQuery, setClearingQuery] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [feesQuery, setFeesQuery] = useState("");
  const [gstQuery, setGstQuery] = useState("");

  const [clearingOptions, setClearingOptions] = useState<AccountOption[]>([]);
  const [bankOptions, setBankOptions] = useState<AccountOption[]>([]);
  const [feesOptions, setFeesOptions] = useState<AccountOption[]>([]);
  const [gstOptions, setGstOptions] = useState<AccountOption[]>([]);

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [endDate, setEndDate] = useState(() => new Date());

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

  const loadSettlements = async (token?: string | null) => {
    const response = await fetch("/api/erp/finance/razorpay/settlements", {
      headers: getAuthHeaders(token),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Unable to load settlements.");
      return;
    }
    setSettlements((payload?.data || []) as SettlementRow[]);
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

      const token = (context as CompanyContext)?.session?.access_token ?? null;
      const response = await fetch("/api/erp/finance/razorpay/settlements/config", {
        headers: getAuthHeaders(token),
      });
      const payload = await response.json();
      if (!active) return;

      if (!response.ok) {
        setError(payload?.error || "Unable to load Razorpay settlement config.");
      } else if (payload?.data) {
        setForm((prev) => ({
          ...prev,
          razorpayKeyId: payload.data.razorpay_key_id ?? "",
          razorpayClearingAccountId: payload.data.razorpay_clearing_account_id ?? "",
          bankAccountId: payload.data.bank_account_id ?? "",
          gatewayFeesAccountId: payload.data.gateway_fees_account_id ?? "",
          gstInputOnFeesAccountId: payload.data.gst_input_on_fees_account_id ?? "",
          hasKeySecret: Boolean(payload.data.has_key_secret),
        }));
      }

      await loadSettlements(token);
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
      const params = new URLSearchParams();
      if (clearingQuery.trim()) params.set("q", clearingQuery.trim());
      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load clearing accounts.");
        return;
      }
      setClearingOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [clearingQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (bankQuery.trim()) params.set("q", bankQuery.trim());
      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load bank accounts.");
        return;
      }
      setBankOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bankQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (feesQuery.trim()) params.set("q", feesQuery.trim());
      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load fee accounts.");
        return;
      }
      setFeesOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [feesQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (gstQuery.trim()) params.set("q", gstQuery.trim());
      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load GST input accounts.");
        return;
      }
      setGstOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gstQuery, ctx?.session?.access_token]);

  const handleSave = async () => {
    if (!canWrite) {
      setError("Only finance admins can update Razorpay settlement config.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/erp/finance/razorpay/settlements/config", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          razorpayKeyId: form.razorpayKeyId.trim(),
          razorpayKeySecret: form.razorpayKeySecret.trim() || null,
          razorpayClearingAccountId: form.razorpayClearingAccountId || null,
          bankAccountId: form.bankAccountId || null,
          gatewayFeesAccountId: form.gatewayFeesAccountId || null,
          gstInputOnFeesAccountId: form.gstInputOnFeesAccountId || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save Razorpay settlement config.");
      }
      setNotice("Razorpay settlement config updated.");
      setForm((prev) => ({ ...prev, razorpayKeySecret: "", hasKeySecret: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save Razorpay settlement config.";
      setError(message || "Unable to save Razorpay settlement config.");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!ctx?.session?.access_token) return;
    setSyncing(true);
    setSyncNotice("");
    setError("");

    try {
      const response = await fetch("/api/erp/finance/razorpay/settlements/sync", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          start_date: formatDateInput(startDate),
          end_date: formatDateInput(endDate),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Sync failed.");
      }
      setSyncNotice(`Synced ${payload.data?.ingested ?? 0} settlements.`);
      await loadSettlements();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed.";
      setError(message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handlePreview = async (settlementId: string) => {
    setPreviewLoading(true);
    setSelectedSettlementId(settlementId);
    setPreviewData(null);
    setError("");

    try {
      const response = await fetch(`/api/erp/finance/razorpay/settlements/${settlementId}/preview`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load preview.");
      }
      setPreviewData(payload.data || null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load preview.";
      setError(message || "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePost = async (settlementId: string) => {
    if (!canWrite) {
      setError("Only finance admins can post settlements.");
      return;
    }
    setError("");

    try {
      const response = await fetch(`/api/erp/finance/razorpay/settlements/${settlementId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to post settlement.");
      }
      await loadSettlements();
      if (selectedSettlementId === settlementId) {
        await handlePreview(settlementId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to post settlement.";
      setError(message || "Failed to post settlement.");
    }
  };

  const selectedClearing = clearingOptions.find((option) => option.id === form.razorpayClearingAccountId) || null;
  const selectedBank = bankOptions.find((option) => option.id === form.bankAccountId) || null;
  const selectedFees = feesOptions.find((option) => option.id === form.gatewayFeesAccountId) || null;
  const selectedGst = gstOptions.find((option) => option.id === form.gstInputOnFeesAccountId) || null;

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Razorpay settlements…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Razorpay Settlements"
            description="Sync Razorpay settlements and post finance journals."
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
          eyebrow="Finance"
          title="Razorpay Settlements"
          description="Sync Razorpay settlements and post bank journals."
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
              {saving ? "Saving…" : "Save Config"}
            </button>
          }
        />

        <div style={{ ...cardStyle, marginTop: 0 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Link href="/erp/finance/masters/gl-accounts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Open Chart of Accounts
            </Link>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <label style={labelStyle}>
              Razorpay Key ID
              <input
                style={inputStyle}
                value={form.razorpayKeyId}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayKeyId: event.target.value }))}
                placeholder="rzp_test_..."
              />
            </label>
            <label style={labelStyle}>
              Razorpay Key Secret
              <input
                style={inputStyle}
                type="password"
                value={form.razorpayKeySecret}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayKeySecret: event.target.value }))}
                placeholder={form.hasKeySecret ? "Saved — enter to update" : "Enter Razorpay secret"}
              />
              {form.hasKeySecret && !form.razorpayKeySecret ? (
                <span style={hintStyle}>Secret stored. Leave blank to keep existing.</span>
              ) : null}
            </label>

            <label style={labelStyle}>
              Razorpay Clearing Account (1102)
              <input
                style={inputStyle}
                value={clearingQuery}
                onChange={(event) => setClearingQuery(event.target.value)}
                placeholder="Search clearing account by code or name"
              />
              <select
                style={inputStyle}
                value={form.razorpayClearingAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayClearingAccountId: event.target.value }))}
              >
                <option value="">Select clearing account</option>
                {clearingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedClearing
                  ? `Selected: ${formatAccountLabel(selectedClearing)}`
                  : `ID: ${form.razorpayClearingAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              Bank Account (ICICI)
              <input
                style={inputStyle}
                value={bankQuery}
                onChange={(event) => setBankQuery(event.target.value)}
                placeholder="Search bank account by code or name"
              />
              <select
                style={inputStyle}
                value={form.bankAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, bankAccountId: event.target.value }))}
              >
                <option value="">Select bank account</option>
                {bankOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedBank ? `Selected: ${formatAccountLabel(selectedBank)}` : `ID: ${form.bankAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              Gateway Fees Account (optional)
              <input
                style={inputStyle}
                value={feesQuery}
                onChange={(event) => setFeesQuery(event.target.value)}
                placeholder="Search gateway fees account by code or name"
              />
              <select
                style={inputStyle}
                value={form.gatewayFeesAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, gatewayFeesAccountId: event.target.value }))}
              >
                <option value="">Select fees account</option>
                {feesOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedFees ? `Selected: ${formatAccountLabel(selectedFees)}` : `ID: ${form.gatewayFeesAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              GST Input on Fees Account (optional)
              <input
                style={inputStyle}
                value={gstQuery}
                onChange={(event) => setGstQuery(event.target.value)}
                placeholder="Search GST input account by code or name"
              />
              <select
                style={inputStyle}
                value={form.gstInputOnFeesAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, gstInputOnFeesAccountId: event.target.value }))}
              >
                <option value="">Select GST input account</option>
                {gstOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedGst
                  ? `Selected: ${formatAccountLabel(selectedGst)}`
                  : `ID: ${form.gstInputOnFeesAccountId}`}
              </span>
            </label>
          </div>

          {notice ? <div style={{ marginTop: 12, color: "#047857", fontSize: 13 }}>{notice}</div> : null}
          {error ? <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>{error}</div> : null}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Sync from Razorpay</h3>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label style={labelStyle}>
              Start Date
              <input
                style={inputStyle}
                type="date"
                value={formatDateInput(startDate)}
                onChange={(event) => setStartDate(new Date(event.target.value))}
              />
            </label>
            <label style={labelStyle}>
              End Date
              <input
                style={inputStyle}
                type="date"
                value={formatDateInput(endDate)}
                onChange={(event) => setEndDate(new Date(event.target.value))}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={handleSync}
              style={{
                ...primaryButtonStyle,
                backgroundColor: syncing ? "#6b7280" : "#111827",
              }}
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Sync from Razorpay"}
            </button>
            {syncNotice ? <span style={{ fontSize: 13, color: "#047857" }}>{syncNotice}</span> : null}
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Settlement</th>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Posted</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {settlements.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No settlements synced yet.
                  </td>
                </tr>
              ) : (
                settlements.map((settlement) => (
                  <tr key={settlement.id}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{settlement.razorpay_settlement_id}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{settlement.settlement_utr || "—"}</div>
                    </td>
                    <td style={tableCellStyle}>{formatDate(settlement.settled_at)}</td>
                    <td style={tableCellStyle}>{formatAmount(settlement.amount)}</td>
                    <td style={tableCellStyle}>{settlement.status || "—"}</td>
                    <td style={tableCellStyle}>
                      {settlement.posted_journal_id ? (
                        <Link href={`/erp/finance/journals/${settlement.posted_journal_id}`}>
                          {settlement.posted_doc_no || "View Journal"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handlePreview(settlement.razorpay_settlement_id)}
                          style={secondaryButtonStyle}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePost(settlement.razorpay_settlement_id)}
                          style={{
                            ...secondaryButtonStyle,
                            backgroundColor: canWrite ? "#111827" : "#9ca3af",
                            color: "#fff",
                            borderColor: "transparent",
                          }}
                          disabled={!canWrite}
                        >
                          Post
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Settlement Preview</h3>
          {previewLoading ? (
            <p>Loading preview…</p>
          ) : previewData ? (
            <pre
              style={{
                margin: 0,
                background: "#0f172a",
                color: "#e2e8f0",
                padding: 16,
                borderRadius: 8,
                fontSize: 12,
                overflowX: "auto",
              }}
            >
              {JSON.stringify(previewData, null, 2)}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>
              Select a settlement to preview the journal lines before posting.
            </p>
          )}
        </div>
      </div>
    </ErpShell>
  );
}
