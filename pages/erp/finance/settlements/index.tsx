import { useEffect, useMemo, useState } from "react";
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
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const statusColors: Record<string, { backgroundColor: string; color: string }> = {
  Matched: { backgroundColor: "#dcfce7", color: "#166534" },
  Pending: { backgroundColor: "#fef3c7", color: "#92400e" },
  "Pending Bank": { backgroundColor: "#e0e7ff", color: "#3730a3" },
};

type GmailToast = { type: "success" | "error"; message: string } | null;

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function FinanceSettlementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null as any);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [gmailSettings, setGmailSettings] = useState<any>(null);
  const [gmailBatches, setGmailBatches] = useState<any[]>([]);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailToast, setGmailToast] = useState<GmailToast>(null);
  const [gmailResult, setGmailResult] = useState<any>(null);

  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return start;
  }, []);

  const [fromDate, setFromDate] = useState(formatDateInput(defaultFrom));
  const [toDate, setToDate] = useState(formatDateInput(today));

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const fetchSettlementData = async () => {
    setStatusMessage("");

    const { data: summaryData, error: summaryError } = await supabase.rpc(
      "erp_settlement_status_summary",
      {
        p_from: fromDate,
        p_to: toDate,
      }
    );

    if (summaryError) {
      setStatusMessage(summaryError.message);
      return;
    }

    const { data: listData, error: listError } = await supabase.rpc("erp_settlement_events_list", {
      p_from: fromDate,
      p_to: toDate,
      p_platform: "amazon",
      p_event_type: "AMAZON_SETTLEMENT",
    });

    if (listError) {
      setStatusMessage(listError.message);
      return;
    }

    setSummary(summaryData || null);
    setRows(listData || []);
  };

  const fetchGmailData = async () => {
    const [{ data: settingsData, error: settingsError }, { data: batchesData, error: batchesError }] =
      await Promise.all([
        supabase.rpc("erp_company_settings_get"),
        supabase.rpc("erp_email_ingest_batches_recent", { p_limit: 10 }),
      ]);

    if (settingsError) {
      setGmailToast({ type: "error", message: settingsError.message });
    } else {
      setGmailSettings(settingsData?.[0] ?? null);
    }

    if (batchesError) {
      setGmailToast({ type: "error", message: batchesError.message });
    } else {
      setGmailBatches(batchesData || []);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchSettlementData();
    fetchGmailData();
  }, [ctx?.companyId, fromDate, toDate]);

  const handleRunReconcile = async () => {
    setReconciling(true);
    setStatusMessage("");
    const { error: reconcileError } = await supabase.rpc("erp_settlement_reconcile_run", {
      p_from: fromDate,
      p_to: toDate,
    });
    if (reconcileError) {
      setStatusMessage(reconcileError.message);
    } else {
      setStatusMessage("Reconciliation completed.");
      await fetchSettlementData();
    }
    setReconciling(false);
  };

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadMessage("");
    setUploading(true);

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("bankCsv") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setUploadMessage("Please choose a CSV file.");
      setUploading(false);
      return;
    }

    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token;
    if (!accessToken) {
      setUploadMessage("You must be signed in to upload files.");
      setUploading(false);
      return;
    }

    const payload = new FormData();
    payload.append("file", file);

    const response = await fetch("/api/finance/settlements/bank-upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: payload,
    });

    const result = await response.json();
    if (!response.ok) {
      setUploadMessage(result?.error || "Failed to upload CSV");
    } else {
      setUploadMessage(`Uploaded ${result.inserted_count} credit rows.`);
      form.reset();
      await fetchSettlementData();
    }

    setUploading(false);
  };

  const handleGmailSync = async () => {
    setGmailSyncing(true);
    setGmailToast(null);
    setGmailResult(null);

    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      setGmailToast({ type: "error", message: "You must be signed in to sync Gmail." });
      setGmailSyncing(false);
      return;
    }

    const query = new URLSearchParams({ start: fromDate, end: toDate });
    const response = await fetch(`/api/finance/settlements/gmail-sync?${query.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();
    setGmailResult(result);

    if (!response.ok || !result?.ok) {
      setGmailToast({ type: "error", message: result?.error || "Gmail sync failed." });
    } else {
      setGmailToast({
        type: "success",
        message: `Gmail sync complete. Scanned ${result.scanned}, imported ${result.imported}, skipped ${result.skipped}.`,
      });
      await fetchSettlementData();
    }

    await fetchGmailData();
    setGmailSyncing(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading settlements…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Settlement Reconciliation"
            description="Track Amazon → Indifi → Bank settlement flow."
            rightActions={
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            }
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
          eyebrow="Finance"
          title="Settlement Reconciliation"
          description="Review settlement events, upload bank credits, and reconcile chains."
          rightActions={
            <>
              <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to Finance
              </Link>
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            </>
          }
        />

        <section style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>To</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            onClick={handleRunReconcile}
            style={primaryButtonStyle}
            disabled={reconciling}
          >
            {reconciling ? "Reconciling…" : "Run Reconcile"}
          </button>
        </section>

        {statusMessage ? <p style={{ margin: 0, color: "#b45309" }}>{statusMessage}</p> : null}

        <section style={{ ...cardStyle, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Gmail Sync</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Gmail</p>
              <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
                {gmailSettings?.gmail_connected ? "Connected" : "Not connected"}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Last Gmail Sync</p>
              <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
                {formatDateTime(gmailSettings?.gmail_last_synced_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleGmailSync}
              style={primaryButtonStyle}
              disabled={gmailSyncing}
            >
              {gmailSyncing ? "Syncing…" : "Sync from Gmail"}
            </button>
          </div>
          {gmailToast ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: gmailToast.type === "error" ? "#fef2f2" : "#ecfdf5",
                color: gmailToast.type === "error" ? "#991b1b" : "#065f46",
                border: `1px solid ${gmailToast.type === "error" ? "#fecaca" : "#a7f3d0"}`,
              }}
            >
              {gmailToast.message}
            </div>
          ) : null}
          {gmailResult ? (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              <p style={{ margin: "0 0 6px" }}>
                Scanned {gmailResult.scanned} emails • Imported {gmailResult.imported} • Skipped{" "}
                {gmailResult.skipped}
              </p>
              {gmailResult.totals ? (
                <p style={{ margin: 0, color: "#6b7280" }}>
                  Amazon matches {gmailResult.totals.amazon} • Indifi incoming{" "}
                  {gmailResult.totals.indifi_in} • Indifi outgoing{" "}
                  {gmailResult.totals.indifi_out} • Deduped {gmailResult.totals.deduped}
                </p>
              ) : null}
              {gmailResult.errors?.length ? (
                <div>
                  <p style={{ margin: "0 0 6px", color: "#991b1b", fontWeight: 600 }}>
                    Errors
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 20, color: "#991b1b" }}>
                    {gmailResult.errors.map((err: any, index: number) => (
                      <li key={`${err.messageId}-${index}`}>
                        {err.messageId}: {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {[
            { label: "Settlements", value: summary?.settlements_total ?? 0 },
            { label: "Linked to Indifi", value: summary?.settlements_linked_to_indifi ?? 0 },
            { label: "Indifi Linked to Bank", value: summary?.indifi_linked_to_bank ?? 0 },
            { label: "Pending Settlements", value: summary?.pending_settlements ?? 0 },
            { label: "Pending Indifi", value: summary?.pending_indifi ?? 0 },
            { label: "Mismatches", value: summary?.mismatches ?? 0 },
          ].map((card) => (
            <div key={card.label} style={{ ...cardStyle, padding: 16 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{card.label}</p>
              <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600 }}>{card.value}</p>
            </div>
          ))}
        </section>

        <section style={{ ...cardStyle, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Upload Bank CSV</h3>
          <form onSubmit={handleUpload} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <input type="file" name="bankCsv" accept=".csv" style={inputStyle} />
            <button type="submit" style={primaryButtonStyle} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload Bank CSV"}
            </button>
          </form>
          {uploadMessage ? <p style={{ margin: "12px 0 0" }}>{uploadMessage}</p> : null}
        </section>

        <section style={{ ...cardStyle, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Recent Gmail Imports</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Received</th>
                <th style={tableHeaderCellStyle}>Subject</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Parsed Events</th>
                <th style={tableHeaderCellStyle}>Error</th>
              </tr>
            </thead>
            <tbody>
              {gmailBatches.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No Gmail imports yet.
                  </td>
                </tr>
              ) : (
                gmailBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td style={tableCellStyle}>{formatDateTime(batch.received_at)}</td>
                    <td style={tableCellStyle}>{batch.subject || "—"}</td>
                    <td style={tableCellStyle}>{batch.status}</td>
                    <td style={tableCellStyle}>{batch.parsed_event_count ?? 0}</td>
                    <td style={tableCellStyle}>{batch.error_text || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Indifi Ref</th>
                <th style={tableHeaderCellStyle}>Bank Ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No settlement events in this range.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tableCellStyle}>{row.event_date}</td>
                    <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                    <td style={tableCellStyle}>₹ {formatCurrency(Number(row.amount || 0))}</td>
                    <td style={tableCellStyle}>
                      <span
                        style={{
                          ...badgeStyle,
                          ...(statusColors[row.status] || {}),
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={tableCellStyle}>{row.indifi_reference_no || "—"}</td>
                    <td style={tableCellStyle}>{row.bank_reference_no || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
