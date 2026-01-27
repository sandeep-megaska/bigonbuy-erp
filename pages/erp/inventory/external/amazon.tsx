import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type LatestBatch = z.infer<typeof latestBatchSchema>;

type InventoryRow = z.infer<typeof inventoryRowSchema>;

const latestBatchSchema = z
  .object({
    id: z.string().uuid(),
    channel_key: z.string(),
    marketplace_id: z.string().nullable(),
    pulled_at: z.string(),
    row_count: z.number(),
    matched_count: z.number(),
    unmatched_count: z.number(),
    status: z.string().optional(),
    report_id: z.string().nullable().optional(),
    report_processing_status: z.string().nullable().optional(),
    report_response: z.unknown().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .nullable();

const inventoryRowSchema = z.object({
  id: z.string().uuid(),
  external_sku: z.string(),
  asin: z.string().nullable(),
  fnsku: z.string().nullable(),
  condition: z.string().nullable(),
  qty_available: z.number(),
  qty_reserved: z.number(),
  qty_inbound_working: z.number(),
  qty_inbound_shipped: z.number(),
  qty_inbound_receiving: z.number(),
  external_location_code: z.string().nullable(),
  match_status: z.string(),
  erp_variant_id: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  variant_title: z.string().nullable(),
  variant_size: z.string().nullable(),
  variant_color: z.string().nullable(),
  variant_hsn: z.string().nullable(),
  erp_warehouse_id: z.string().uuid().nullable(),
  warehouse_name: z.string().nullable(),
});

const reportRequestSchema = z.object({
  ok: z.boolean(),
  batchId: z.string().uuid().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
});

const reportStatusSchema = z.object({
  ok: z.boolean(),
  status: z.string().optional(),
  message: z.string().optional(),
  rowsInserted: z.number().optional(),
  matched: z.number().optional(),
  unmatched: z.number().optional(),
  error: z.string().optional(),
  details: z.string().optional(),
});

const testResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const rowLimit = 500;
const pollBackoffMs = [2000, 4000, 8000, 15000, 20000];

export default function AmazonExternalInventoryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestBatch, setLatestBatch] = useState<LatestBatch>(null);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [reportBatchId, setReportBatchId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const pollCountRef = useRef(0);

  const canAccess = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "inventory", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadRows = useCallback(async (batchId: string, onlyUnmatchedRows: boolean) => {
    setIsLoadingRows(true);
    setError(null);

    const { data, error: rowsError } = await supabase.rpc("erp_external_inventory_rows_list", {
      p_batch_id: batchId,
      p_only_unmatched: onlyUnmatchedRows,
      p_limit: rowLimit,
      p_offset: 0,
    });

    if (rowsError) {
      setIsLoadingRows(false);
      setError(rowsError.message);
      return;
    }

    const parsed = z.array(inventoryRowSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setIsLoadingRows(false);
      setError("Failed to parse inventory rows.");
      return;
    }

    setRows(parsed.data);
    setIsLoadingRows(false);
  }, []);

  const loadBatchSummary = useCallback(async (batchId: string) => {
    const { data, error: batchError } = await supabase
      .from("erp_external_inventory_batches")
      .select(
        "id, channel_key, marketplace_id, pulled_at, rows_total, matched_count, unmatched_count, status, report_id, external_report_id, report_processing_status, report_response, error"
      )
      .eq("id", batchId)
      .maybeSingle();

    if (batchError || !data) {
      return;
    }

    const summary = {
      id: data.id,
      channel_key: data.channel_key,
      marketplace_id: data.marketplace_id,
      pulled_at: data.pulled_at,
      row_count: data.rows_total ?? 0,
      matched_count: data.matched_count ?? 0,
      unmatched_count: data.unmatched_count ?? 0,
      status: data.status ?? null,
      report_id: data.report_id ?? data.external_report_id ?? null,
      report_processing_status: data.report_processing_status ?? null,
      report_response: data.report_response ?? null,
      error: data.error ?? null,
    };
    const parsed = latestBatchSchema.safeParse(summary);
    if (parsed.success) {
      setLatestBatch(parsed.data);
    }
  }, []);

  useEffect(() => {
    if (!latestBatch?.id) {
      setRows([]);
      return;
    }

    (async () => {
      await loadRows(latestBatch.id, onlyUnmatched);
    })();
  }, [latestBatch?.id, loadRows, onlyUnmatched]);

  const handleTestConnection = async () => {
    setNotice(null);
    setError(null);
    setIsTesting(true);

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setIsTesting(false);
      setError("Missing session token. Please sign in again.");
      return;
    }

    try {
      const response = await fetch("/api/integrations/amazon/test", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: unknown = await response.json();
      const parsed = testResponseSchema.safeParse(json);
      if (!parsed.success) {
        setError("Unexpected test response.");
      } else if (!parsed.data.ok) {
        setError(parsed.data.error || "Amazon test failed.");
      } else {
        setNotice(parsed.data.message || "Amazon connection successful.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsTesting(false);
    }
  };

  const handlePullSnapshot = async () => {
    setNotice(null);
    setError(null);
    setIsPulling(true);
    setReportStatus(null);
    pollCountRef.current = 0;

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setIsPulling(false);
      setError("Missing session token. Please sign in again.");
      return;
    }

    try {
      const response = await fetch("/api/integrations/amazon/pull-inventory-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      const parsed = reportRequestSchema.safeParse(json);
      if (!parsed.success) {
        setError("Unexpected report request response.");
      } else if (!parsed.data.ok) {
        setError(parsed.data.error || "Failed to request inventory report.");
      } else if (!parsed.data.batchId) {
        setError("Report requested but no batch ID was returned.");
      } else {
        setReportBatchId(parsed.data.batchId);
        setReportStatus("requested");
        setNotice("Status: requested — Report requested. Waiting for Amazon to generate the inventory snapshot…");
        await loadBatchSummary(parsed.data.batchId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsPulling(false);
    }
  };

  useEffect(() => {
    if (!reportBatchId || reportStatus === "completed" || reportStatus === "failed") {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      setIsPolling(true);
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setIsPolling(false);
        setError("Missing session token. Please sign in again.");
        return;
      }

      let nextStatus: string | null = null;

      try {
        const response = await fetch(
          `/api/integrations/amazon/fetch-inventory-report?batchId=${reportBatchId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json: unknown = await response.json();
        const parsed = reportStatusSchema.safeParse(json);
        if (!parsed.success) {
          setError("Unexpected report status response.");
          setReportStatus("failed");
          nextStatus = "failed";
          return;
        }

        if (!parsed.data.ok) {
          setError(parsed.data.error || "Failed to fetch report status.");
          setReportStatus("failed");
          nextStatus = "failed";
          return;
        }

        nextStatus = parsed.data.status ?? "processing";
        const message = parsed.data.message ?? null;
        setReportStatus(nextStatus);

        const statusNotice = `Status: ${nextStatus}${message ? ` — ${message}` : ""}`;

        if (nextStatus === "completed") {
          const matched = parsed.data.matched ?? 0;
          const unmatched = parsed.data.unmatched ?? 0;
          const total = matched + unmatched;
          setNotice(`${statusNotice}. Pulled ${total} rows (${matched} matched, ${unmatched} unmatched).`);
          await loadBatchSummary(reportBatchId);
        } else if (nextStatus === "failed") {
          setError(statusNotice || "Amazon report generation failed.");
          await loadBatchSummary(reportBatchId);
        } else {
          setNotice(statusNotice || "Generating report…");
          await loadBatchSummary(reportBatchId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setReportStatus("failed");
        nextStatus = "failed";
      } finally {
        if (cancelled) {
          setIsPolling(false);
          return;
        }

        if (nextStatus === "completed" || nextStatus === "failed") {
          setIsPolling(false);
          return;
        }

        const delay =
          pollBackoffMs[Math.min(pollCountRef.current, pollBackoffMs.length - 1)];
        pollCountRef.current += 1;
        timeoutId = setTimeout(poll, delay);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [reportBatchId, reportStatus, loadBatchSummary]);

  const handleExportUnmatched = () => {
    const unmatchedRows = rows.filter((row) => row.match_status === "unmatched");
    if (unmatchedRows.length === 0) {
      setNotice("No unmatched rows to export.");
      return;
    }

    const headers = [
      "external_sku",
      "external_location_code",
      "asin",
      "fnsku",
      "condition",
      "qty_available",
      "qty_reserved",
      "qty_inbound_working",
      "qty_inbound_shipped",
      "qty_inbound_receiving",
    ];
    const csvRows = unmatchedRows.map((row) => [
      row.external_sku,
      row.external_location_code || "",
      row.asin || "",
      row.fnsku || "",
      row.condition || "",
      row.qty_available,
      row.qty_reserved,
      row.qty_inbound_working,
      row.qty_inbound_shipped,
      row.qty_inbound_receiving,
    ]);
    const csv = [
      headers.join(","),
      ...csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    triggerDownload("amazon_unmatched_inventory.csv", createCsvBlob(csv));
  };

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading Amazon inventory snapshot…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error || "No company context available."}</div>
      </ErpShell>
    );
  }

  if (!canAccess) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>You do not have access to Amazon inventory snapshots.</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>External Inventory</p>
            <h1 style={h1Style}>Amazon Inventory Snapshot</h1>
            <p style={subtitleStyle}>Pull a read-only snapshot from Amazon FBA to compare with ERP stock.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={handleTestConnection} style={secondaryButtonStyle} disabled={isTesting}>
              {isTesting ? "Testing…" : "Test Connection"}
            </button>
            <button
              type="button"
              onClick={handlePullSnapshot}
              style={primaryButtonStyle}
              disabled={isPulling || isPolling}
            >
              {isPulling ? "Requesting…" : isPolling ? "Generating report…" : "Pull Snapshot Now"}
            </button>
          </div>
        </header>

        {(notice || error) && (
          <div
            style={{
              ...cardStyle,
              borderColor: error ? "#fca5a5" : "#bbf7d0",
              color: error ? "#b91c1c" : "#047857",
            }}
          >
            {error || notice}
          </div>
        )}

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Latest batch</h2>
          {latestBatch ? (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <div style={summaryRowStyle}>
                <span>Batch ID</span>
                <span style={summaryValueStyle}>{latestBatch.id}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Report ID</span>
                <span style={summaryValueStyle}>{latestBatch.report_id || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Report status</span>
                <span style={summaryValueStyle}>{latestBatch.report_processing_status || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Pulled at</span>
                <span style={summaryValueStyle}>{new Date(latestBatch.pulled_at).toLocaleString()}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Marketplace</span>
                <span style={summaryValueStyle}>{latestBatch.marketplace_id || "Amazon"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Total rows</span>
                <span style={summaryValueStyle}>{latestBatch.row_count}</span>
              </div>
              <div style={summaryRowStyle}>
                <span>Matched / Unmatched</span>
                <span style={summaryValueStyle}>
                  {latestBatch.matched_count} / {latestBatch.unmatched_count}
                </span>
              </div>
              {(latestBatch.status === "fatal" || latestBatch.report_processing_status === "FATAL") && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, color: "#b91c1c" }}>
                    Debug details
                  </summary>
                  <div style={{ marginTop: 8, color: "#111827", fontSize: 14 }}>
                    <div style={{ marginBottom: 8 }}>
                      <strong>Last error</strong>
                      <div style={{ marginTop: 4 }}>{latestBatch.error || "No error message captured."}</div>
                    </div>
                    <div>
                      <strong>Report response</strong>
                      <pre
                        style={{
                          marginTop: 4,
                          padding: 12,
                          background: "#f9fafb",
                          borderRadius: 8,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {latestBatch.report_response
                          ? JSON.stringify(latestBatch.report_response, null, 2)
                          : "No report payload captured."}
                      </pre>
                    </div>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 12, color: "#6b7280" }}>No snapshot pulled yet.</div>
          )}
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Snapshot rows</h2>
              <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
                {isLoadingRows ? "Loading rows…" : `${rows.length} rows loaded (limit ${rowLimit}).`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" }}>
                <input
                  type="checkbox"
                  checked={onlyUnmatched}
                  onChange={(event) => setOnlyUnmatched(event.target.checked)}
                />
                Only unmatched
              </label>
              <button type="button" onClick={handleExportUnmatched} style={secondaryButtonStyle}>
                Export unmatched CSV
              </button>
            </div>
          </div>
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>External SKU</th>
                  <th style={tableHeaderCellStyle}>Match status</th>
                  <th style={tableHeaderCellStyle}>ERP SKU</th>
                  <th style={tableHeaderCellStyle}>Product</th>
                  <th style={tableHeaderCellStyle}>Size</th>
                  <th style={tableHeaderCellStyle}>Color</th>
                  <th style={tableHeaderCellStyle}>Available</th>
                  <th style={tableHeaderCellStyle}>Inbound total</th>
                  <th style={tableHeaderCellStyle}>Location</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
                      {latestBatch
                        ? "No rows to display."
                        : reportBatchId
                          ? "Report in progress…"
                          : "Pull a snapshot to view inventory."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td style={tableCellStyle}>{row.external_sku}</td>
                      <td style={tableCellStyle}>{row.match_status}</td>
                      <td style={tableCellStyle}>{row.sku || "—"}</td>
                      <td style={tableCellStyle}>{row.variant_title || "—"}</td>
                      <td style={tableCellStyle}>{row.variant_size || "—"}</td>
                      <td style={tableCellStyle}>{row.variant_color || "—"}</td>
                      <td style={tableCellStyle}>{row.qty_available}</td>
                      <td style={tableCellStyle}>
                        {row.qty_inbound_working + row.qty_inbound_shipped + row.qty_inbound_receiving}
                      </td>
                      <td style={tableCellStyle}>{row.external_location_code || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}

const summaryRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  color: "#374151",
};

const summaryValueStyle: CSSProperties = {
  fontWeight: 600,
  color: "#111827",
};
