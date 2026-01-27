import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { useRouter } from "next/router";
import Papa from "papaparse";
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
import VariantTypeahead, { VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type LatestBatch = z.infer<typeof latestBatchSchema>;

type InventoryRow = z.infer<typeof inventoryRowSchema>;

type ChannelSkuMapping = z.infer<typeof channelSkuMappingSchema>;

type BatchListItem = z.infer<typeof batchListItemSchema>;

type ImportErrorRow = {
  row_index: number;
  external_sku?: string | null;
  erp_sku?: string | null;
  reason: string;
};

type MappingImportRow = {
  external_sku: string;
  erp_sku?: string | null;
  mapped_variant_id?: string | null;
  asin?: string | null;
  fnsku?: string | null;
  notes?: string | null;
  active?: boolean | null;
};

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

const batchListItemSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  pulled_at: z.string(),
  rows_total: z.number().nullable().optional(),
  matched_count: z.number().nullable().optional(),
  unmatched_count: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  report_processing_status: z.string().nullable().optional(),
});

const inventoryRowSchema = z.object({
  id: z.string().uuid(),
  batch_id: z.string().uuid(),
  external_sku: z.string(),
  match_status: z.string(),
  erp_variant_id: z.string().uuid().nullable(),
  matched_variant_id: z.string().uuid().nullable(),
  available_qty: z.number(),
  inbound_qty: z.number(),
  reserved_qty: z.number(),
  location: z.string().nullable(),
  external_location_code: z.string().nullable(),
  marketplace_id: z.string().nullable(),
  asin: z.string().nullable(),
  fnsku: z.string().nullable(),
  sku: z.string().nullable(),
  variant_title: z.string().nullable(),
  variant_size: z.string().nullable(),
  variant_color: z.string().nullable(),
});

const channelSkuMappingSchema = z.object({
  id: z.string().uuid(),
  external_sku: z.string(),
  external_sku_norm: z.string(),
  marketplace_id: z.string().nullable(),
  asin: z.string().nullable(),
  fnsku: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
  mapped_variant_id: z.string().uuid(),
  sku: z.string().nullable(),
  style_code: z.string().nullable(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
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

const bulkUpsertResponseSchema = z.object({
  ok: z.boolean(),
  inserted_or_updated: z.number().optional(),
  skipped: z.number().optional(),
  errors: z
    .array(
      z.object({
        row_index: z.number(),
        reason: z.string(),
        external_sku: z.string().nullable().optional(),
      })
    )
    .optional(),
});

const variantResolveSchema = z.array(
  z.object({
    sku: z.string(),
    variant_id: z.string().uuid(),
    style_code: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })
);

const rowLimit = 500;
const pollBackoffMs = [2000, 4000, 8000, 15000, 20000];

const normalizeSku = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeCsvHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

const parseCsvBoolean = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return null;
};

export default function AmazonExternalInventoryPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [latestBatch, setLatestBatch] = useState<LatestBatch>(null);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [snapshotMode, setSnapshotMode] = useState<"marketplace" | "fc">("marketplace");
  const [viewMode, setViewMode] = useState<"rows" | "location">("rows");
  const [reportBatchId, setReportBatchId] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const [mappingRow, setMappingRow] = useState<InventoryRow | null>(null);
  const [mappingVariant, setMappingVariant] = useState<VariantSearchResult | null>(null);
  const [mappingNotes, setMappingNotes] = useState("");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingsOpen, setMappingsOpen] = useState(false);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsError, setMappingsError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<ChannelSkuMapping[]>([]);
  const [isRematchingBatch, setIsRematchingBatch] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<ImportErrorRow[]>([]);

  useEffect(() => {
    if (snapshotMode !== "fc") {
      setViewMode("rows");
    }
  }, [snapshotMode]);

  const batchIdFromQuery = useMemo(() => {
    if (typeof router.query.batchId === "string") {
      return router.query.batchId;
    }
    return null;
  }, [router.query.batchId]);

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

    // Snapshot rows are served via erp_external_inventory_rows_list in the existing external inventory module.
    const { data, error: rowsError } = await supabase.rpc("erp_external_inventory_rows_list", {
      p_batch_id: batchId,
      p_only_unmatched: onlyUnmatchedRows,
      p_limit: rowLimit,
      p_offset: 0,
    });

    if (rowsError) {
      setIsLoadingRows(false);
      const shouldShowLoadFailure =
        latestBatch?.report_processing_status === "DONE" && (latestBatch?.row_count ?? 0) > 0;
      setError(shouldShowLoadFailure ? "Failed to load snapshot rows." : rowsError.message);
      return;
    }

    const parsed = z.array(inventoryRowSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setIsLoadingRows(false);
      setError("Failed to load snapshot rows.");
      return;
    }

    setRows(parsed.data);
    setIsLoadingRows(false);
  }, [latestBatch?.report_processing_status, latestBatch?.row_count]);

  const loadBatches = useCallback(async () => {
    if (!ctx?.companyId) return;
    setError(null);

    const { data, error: batchesError } = await supabase
      .from("erp_external_inventory_batches")
      .select(
        "id, created_at, pulled_at, rows_total, matched_count, unmatched_count, status, report_processing_status"
      )
      .eq("channel_key", "amazon")
      .order("created_at", { ascending: false })
      .limit(20);

    if (batchesError) {
      setError(batchesError.message || "Failed to load batch history.");
      return;
    }

    const parsed = z.array(batchListItemSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Failed to load batch history.");
      return;
    }

    setBatches(parsed.data);
  }, [ctx?.companyId]);

  const loadMappings = useCallback(async () => {
    if (!ctx?.companyId) return;
    setMappingsLoading(true);
    setMappingsError(null);

    const { data, error: mappingsError } = await supabase.rpc("erp_channel_sku_map_list", {
      p_company_id: ctx.companyId,
      p_channel_key: "amazon",
      p_q: null,
      p_limit: 200,
      p_offset: 0,
    });

    if (mappingsError) {
      setMappingsLoading(false);
      setMappingsError(mappingsError.message || "Failed to load mappings.");
      return;
    }

    const parsed = z.array(channelSkuMappingSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setMappingsLoading(false);
      setMappingsError("Failed to load mappings.");
      return;
    }

    setMappings(parsed.data);
    setMappingsLoading(false);
  }, [ctx?.companyId]);

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
    if (!ctx?.companyId) return;
    loadBatches();
  }, [ctx?.companyId, loadBatches]);

  const newestBatch = useMemo(() => batches[0] ?? null, [batches]);

  const bestBatch = useMemo(() => {
    if (!batches.length) return null;
    const withRows = batches.find((batch) => (batch.rows_total ?? 0) > 0);
    if (withRows) return withRows;
    const doneBatch = batches.find((batch) => batch.report_processing_status === "DONE");
    if (doneBatch) return doneBatch;
    return batches[0];
  }, [batches]);

  useEffect(() => {
    if (!batches.length) return;
    if (selectedBatchId && batches.some((batch) => batch.id === selectedBatchId)) {
      return;
    }

    if (batchIdFromQuery && batches.some((batch) => batch.id === batchIdFromQuery)) {
      setSelectedBatchId(batchIdFromQuery);
      return;
    }

    if (bestBatch) {
      setSelectedBatchId(bestBatch.id);
    }
  }, [batches, batchIdFromQuery, bestBatch, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setLatestBatch(null);
      return;
    }

    (async () => {
      await loadBatchSummary(selectedBatchId);
    })();
  }, [loadBatchSummary, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setRows([]);
      return;
    }

    (async () => {
      await loadRows(selectedBatchId, onlyUnmatched);
    })();
  }, [loadRows, onlyUnmatched, selectedBatchId]);

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
        body: JSON.stringify({ snapshot_mode: snapshotMode }),
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
        await loadBatches();
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
          await loadBatches();
        } else if (nextStatus === "failed") {
          setError(statusNotice || "Amazon report generation failed.");
          await loadBatchSummary(reportBatchId);
          await loadBatches();
        } else {
          setNotice(statusNotice || "Generating report…");
          await loadBatchSummary(reportBatchId);
          await loadBatches();
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

  const handleExportUnmatched = useCallback(async () => {
    setNotice(null);
    setError(null);

    if (!latestBatch?.id) {
      setNotice("No snapshot batch available.");
      return;
    }

    const exportRows: InventoryRow[] = [];
    let offset = 0;

    while (true) {
      const { data, error: exportError } = await supabase.rpc("erp_external_inventory_rows_list", {
        p_batch_id: latestBatch.id,
        p_only_unmatched: true,
        p_limit: rowLimit,
        p_offset: offset,
      });

      if (exportError) {
        setError(exportError.message || "Failed to export unmatched rows.");
        return;
      }

      const parsed = z.array(inventoryRowSchema).safeParse(data ?? []);
      if (!parsed.success) {
        setError("Failed to export unmatched rows.");
        return;
      }

      const chunk = parsed.data;
      exportRows.push(...chunk);
      if (chunk.length < rowLimit) break;
      offset += rowLimit;
    }

    if (exportRows.length === 0) {
      setNotice("No unmatched rows to export.");
      return;
    }

    const headers = [
      "external_sku",
      "asin",
      "fnsku",
      "available_qty",
      "inbound_qty",
      "reserved_qty",
      "marketplace_id",
    ];
    const csvRows = exportRows.map((row) => [
      row.external_sku,
      row.asin || "",
      row.fnsku || "",
      row.available_qty ?? 0,
      row.inbound_qty ?? 0,
      row.reserved_qty ?? 0,
      row.marketplace_id || "",
    ]);
    const csv = [
      headers.join(","),
      ...csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    triggerDownload("amazon_unmatched_inventory.csv", createCsvBlob(csv));
  }, [latestBatch?.id]);

  const handleOpenMapping = useCallback((row: InventoryRow) => {
    setMappingRow(row);
    setMappingVariant(null);
    setMappingNotes("");
    setMappingError(null);
  }, []);

  const handleSaveMapping = useCallback(async () => {
    if (!ctx?.companyId || !mappingRow) return;
    if (!mappingVariant) {
      setMappingError("Select a variant to map.");
      return;
    }

    setMappingSaving(true);
    setMappingError(null);

    const { error: upsertError } = await supabase.rpc("erp_channel_sku_map_upsert", {
      p_company_id: ctx.companyId,
      p_channel_key: "amazon",
      p_marketplace_id: mappingRow.marketplace_id ?? "",
      p_external_sku: mappingRow.external_sku,
      p_asin: mappingRow.asin ?? "",
      p_fnsku: mappingRow.fnsku ?? "",
      p_mapped_variant_id: mappingVariant.variant_id,
      p_active: true,
      p_notes: mappingNotes || "",
    });

    if (upsertError) {
      setMappingSaving(false);
      setMappingError(upsertError.message || "Failed to save mapping.");
      return;
    }

    const { error: rematchError } = await supabase.rpc("erp_external_inventory_rematch_by_external_sku", {
      p_batch_id: mappingRow.batch_id,
      p_external_sku: mappingRow.external_sku,
    });

    if (rematchError) {
      setMappingSaving(false);
      setMappingError(rematchError.message || "Saved mapping, but SKU rematch failed.");
      return;
    }

    await loadBatchSummary(mappingRow.batch_id);
    await loadRows(mappingRow.batch_id, onlyUnmatched);
    setNotice("Mapping saved and SKU rematched.");
    setMappingSaving(false);
    setMappingRow(null);
    setMappingVariant(null);
    setMappingNotes("");
  }, [ctx?.companyId, loadBatchSummary, loadRows, mappingNotes, mappingRow, mappingVariant, onlyUnmatched]);

  const handleRecomputeBatch = useCallback(async () => {
    if (!latestBatch?.id) {
      setNotice("No snapshot batch available.");
      return;
    }

    setNotice(null);
    setError(null);
    setIsRematchingBatch(true);

    const { error: rematchError } = await supabase.rpc("erp_external_inventory_batch_rematch", {
      p_batch_id: latestBatch.id,
    });

    if (rematchError) {
      setError(rematchError.message || "Failed to recompute batch.");
      setIsRematchingBatch(false);
      return;
    }

    await loadBatchSummary(latestBatch.id);
    await loadRows(latestBatch.id, onlyUnmatched);
    setNotice("Batch recomputed.");
    setIsRematchingBatch(false);
  }, [latestBatch?.id, loadBatchSummary, loadRows, onlyUnmatched]);

  const showLatestFailedBanner = useMemo(() => {
    if (!newestBatch || !bestBatch || !selectedBatchId) return false;
    if (newestBatch.id === selectedBatchId) return false;
    return (
      newestBatch.report_processing_status === "FATAL" ||
      newestBatch.status === "fatal" ||
      (newestBatch.rows_total ?? 0) === 0
    );
  }, [bestBatch, newestBatch, selectedBatchId]);

  const latestFailedBannerText = useMemo(() => {
    if (!bestBatch) return null;
    return `Latest pull failed (FATAL). Showing most recent batch with rows from ${new Date(
      bestBatch.created_at
    ).toLocaleString()}.`;
  }, [bestBatch]);

  const formatBatchLabel = useCallback((batch: BatchListItem) => {
    const statusLabel = (batch.report_processing_status ?? batch.status ?? "unknown").toUpperCase();
    const rowCount = batch.rows_total ?? 0;
    const dateLabel = new Date(batch.created_at ?? batch.pulled_at).toLocaleString();
    return `${dateLabel} — ${statusLabel} (${rowCount} rows)`;
  }, []);

  const locationGroups = useMemo(() => {
    if (viewMode !== "location") return [];
    const groupMap = new Map<
      string,
      {
        location: string;
        available: number;
        inbound: number;
        reserved: number;
        items: Map<
          string,
          {
            key: string;
            skuLabel: string;
            variantTitle: string | null;
            variantSize: string | null;
            variantColor: string | null;
            available: number;
            inbound: number;
            reserved: number;
            externalSkus: Set<string>;
          }
        >;
      }
    >();

    rows.forEach((row) => {
      const locationCode = row.external_location_code || row.location || "Unknown";
      const group = groupMap.get(locationCode) ?? {
        location: locationCode,
        available: 0,
        inbound: 0,
        reserved: 0,
        items: new Map(),
      };

      const itemKey = row.matched_variant_id ?? `external:${row.external_sku.toLowerCase()}`;
      const skuLabel = row.sku || row.external_sku;
      const item =
        group.items.get(itemKey) ?? {
          key: itemKey,
          skuLabel,
          variantTitle: row.variant_title ?? null,
          variantSize: row.variant_size ?? null,
          variantColor: row.variant_color ?? null,
          available: 0,
          inbound: 0,
          reserved: 0,
          externalSkus: new Set<string>(),
        };

      item.available += row.available_qty ?? 0;
      item.inbound += row.inbound_qty ?? 0;
      item.reserved += row.reserved_qty ?? 0;
      item.externalSkus.add(row.external_sku);
      group.items.set(itemKey, item);

      group.available += row.available_qty ?? 0;
      group.inbound += row.inbound_qty ?? 0;
      group.reserved += row.reserved_qty ?? 0;

      groupMap.set(locationCode, group);
    });

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        items: Array.from(group.items.values())
          .map((item) => ({
            ...item,
            externalSkuCount: item.externalSkus.size,
          }))
          .sort((a, b) => a.skuLabel.localeCompare(b.skuLabel)),
      }))
      .sort((a, b) => a.location.localeCompare(b.location));
  }, [rows, viewMode]);

  const handleDownloadImportErrors = useCallback(() => {
    if (!importErrors.length) return;
    const headers = ["row_index", "external_sku", "erp_sku", "reason"];
    const csvRows = importErrors.map((row) => [
      row.row_index,
      row.external_sku ?? "",
      row.erp_sku ?? "",
      row.reason,
    ]);
    const csv = [
      headers.join(","),
      ...csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    triggerDownload("amazon_mapping_import_errors.csv", createCsvBlob(csv));
  }, [importErrors]);

  const handleImportMappings = useCallback(
    async (file: File) => {
      if (!ctx?.companyId) return;
      if (!latestBatch?.id) {
        setImportError("Pull a snapshot before importing mappings.");
        return;
      }

      setImportFileName(file.name);
      setImportSummary(null);
      setImportError(null);
      setImportErrors([]);
      setIsImporting(true);

      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          if (results.errors.length) {
            setImportError(results.errors[0]?.message || "Failed to parse CSV.");
            setIsImporting(false);
            return;
          }

          const rawRows = results.data ?? [];
          if (!rawRows.length) {
            setImportError("The CSV file appears to be empty.");
            setIsImporting(false);
            return;
          }

          const parsedRows: Array<MappingImportRow & { row_index: number }> = [];
          const clientErrors: ImportErrorRow[] = [];

          rawRows.forEach((raw, index) => {
            const normalized: Record<string, string> = {};
            Object.entries(raw).forEach(([key, value]) => {
              normalized[normalizeCsvHeader(key)] = typeof value === "string" ? value.trim() : String(value ?? "").trim();
            });

            const externalSku = normalized.external_sku || "";
            const erpSku = normalized.erp_sku || "";
            const mappedVariantId = normalized.mapped_variant_id || "";
            const asin = normalized.asin || "";
            const fnsku = normalized.fnsku || "";
            const notes = normalized.notes || "";
            const activeValue = normalized.active || "";
            const active = parseCsvBoolean(activeValue);

            const hasData = [externalSku, erpSku, mappedVariantId, asin, fnsku, notes, activeValue].some(Boolean);
            if (!hasData) return;

            const rowIndex = index + 1;
            let rowHasError = false;

            if (!externalSku) {
              clientErrors.push({
                row_index: rowIndex,
                external_sku: null,
                erp_sku: erpSku || null,
                reason: "external_sku is required",
              });
              rowHasError = true;
            }

            if (!mappedVariantId && !erpSku) {
              clientErrors.push({
                row_index: rowIndex,
                external_sku: externalSku || null,
                erp_sku: erpSku || null,
                reason: "erp_sku or mapped_variant_id is required",
              });
              rowHasError = true;
            }

            if (activeValue && active === null) {
              clientErrors.push({
                row_index: rowIndex,
                external_sku: externalSku || null,
                erp_sku: erpSku || null,
                reason: "active must be true or false",
              });
              rowHasError = true;
            }

            if (rowHasError) return;

            parsedRows.push({
              row_index: rowIndex,
              external_sku: externalSku,
              erp_sku: erpSku || null,
              mapped_variant_id: mappedVariantId || null,
              asin: asin || null,
              fnsku: fnsku || null,
              notes: notes || null,
              active,
            });
          });

          const pendingResolve = parsedRows
            .filter((row) => !row.mapped_variant_id && row.erp_sku)
            .map((row) => row.erp_sku || "")
            .filter(Boolean);
          const uniqueSkus = Array.from(new Set(pendingResolve.map((sku) => normalizeSku(sku))));
          const resolvedMap = new Map<string, string>();

          if (uniqueSkus.length) {
            const { data: resolveData, error: resolveError } = await supabase.rpc("erp_variants_resolve_by_sku", {
              p_company_id: ctx.companyId,
              p_skus: uniqueSkus,
            });

            if (resolveError) {
              setImportError(resolveError.message || "Failed to resolve ERP SKUs.");
              setIsImporting(false);
              return;
            }

            const parsedResolve = variantResolveSchema.safeParse(resolveData ?? []);
            if (!parsedResolve.success) {
              setImportError("Failed to resolve ERP SKUs.");
              setIsImporting(false);
              return;
            }

            parsedResolve.data.forEach((row) => {
              resolvedMap.set(normalizeSku(row.sku), row.variant_id);
            });
          }

          const rowsForUpsert: MappingImportRow[] = [];
          const upsertRowIndices: number[] = [];
          const resolutionErrors: ImportErrorRow[] = [];

          parsedRows.forEach((row) => {
            let mappedVariantId = row.mapped_variant_id;
            if (!mappedVariantId && row.erp_sku) {
              mappedVariantId = resolvedMap.get(normalizeSku(row.erp_sku)) || null;
            }

            if (!mappedVariantId) {
              resolutionErrors.push({
                row_index: row.row_index,
                external_sku: row.external_sku,
                erp_sku: row.erp_sku ?? null,
                reason: "Unable to resolve ERP SKU",
              });
              return;
            }

            rowsForUpsert.push({
              external_sku: row.external_sku,
              mapped_variant_id: mappedVariantId,
              asin: row.asin ?? null,
              fnsku: row.fnsku ?? null,
              notes: row.notes ?? null,
              active: row.active ?? null,
            });
            upsertRowIndices.push(row.row_index);
          });

          if (!rowsForUpsert.length) {
            setImportErrors([...clientErrors, ...resolutionErrors]);
            setImportError("No valid rows to import.");
            setIsImporting(false);
            return;
          }

          const { data: upsertData, error: upsertError } = await supabase.rpc("erp_channel_sku_map_bulk_upsert", {
            p_company_id: ctx.companyId,
            p_channel_key: "amazon",
            p_marketplace_id: latestBatch.marketplace_id ?? "",
            p_rows: rowsForUpsert,
          });

          if (upsertError) {
            setImportError(upsertError.message || "Failed to import mappings.");
            setIsImporting(false);
            return;
          }

          const parsedUpsert = bulkUpsertResponseSchema.safeParse(upsertData ?? {});
          if (!parsedUpsert.success || !parsedUpsert.data.ok) {
            setImportError("Failed to import mappings.");
            setIsImporting(false);
            return;
          }

          const rpcErrors =
            parsedUpsert.data.errors?.map((err) => {
              const resolvedIndex = upsertRowIndices[err.row_index - 1] ?? err.row_index;
              return {
                row_index: resolvedIndex,
                external_sku: err.external_sku ?? null,
                erp_sku: null,
                reason: err.reason,
              };
            }) ?? [];

          const { error: rematchError } = await supabase.rpc("erp_external_inventory_batch_rematch", {
            p_batch_id: latestBatch.id,
          });

          if (rematchError) {
            setImportError(rematchError.message || "Import succeeded, but batch rematch failed.");
            setIsImporting(false);
            return;
          }

          await loadBatchSummary(latestBatch.id);
          await loadRows(latestBatch.id, onlyUnmatched);

          const inserted = parsedUpsert.data.inserted_or_updated ?? 0;
          const skipped = parsedUpsert.data.skipped ?? 0;
          const totalErrors = [...clientErrors, ...resolutionErrors, ...rpcErrors];

          setImportErrors(totalErrors);
          setImportSummary(`Imported ${inserted} mapping${inserted === 1 ? "" : "s"}. Skipped ${skipped}.`);
          setNotice("Mappings imported and batch rematched.");
          setIsImporting(false);
        },
        error: (parseError) => {
          setImportError(parseError.message || "Failed to parse CSV.");
          setIsImporting(false);
        },
      });
    },
    [ctx?.companyId, latestBatch?.id, latestBatch?.marketplace_id, loadBatchSummary, loadRows, onlyUnmatched]
  );

  const handleImportFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      handleImportMappings(file);
      event.target.value = "";
    },
    [handleImportMappings]
  );

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
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" }}>
              <span>Mode</span>
              <select
                value={snapshotMode}
                onChange={(event) => setSnapshotMode(event.target.value as "marketplace" | "fc")}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }}
              >
                <option value="marketplace">Marketplace totals</option>
                <option value="fc">FC breakdown</option>
              </select>
            </label>
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

        {(notice || error || latestBatch?.status === "fatal" || latestBatch?.report_processing_status === "FATAL") && (
          <div
            style={{
              ...cardStyle,
              borderColor: error || latestBatch?.status === "fatal" || latestBatch?.report_processing_status === "FATAL"
                ? "#fca5a5"
                : "#bbf7d0",
              color: error || latestBatch?.status === "fatal" || latestBatch?.report_processing_status === "FATAL"
                ? "#b91c1c"
                : "#047857",
            }}
          >
            {error ||
              (latestBatch?.status === "fatal" || latestBatch?.report_processing_status === "FATAL"
                ? "Report failed (FATAL)."
                : null) ||
              notice}
          </div>
        )}
        {showLatestFailedBanner && latestFailedBannerText ? (
          <div
            style={{
              ...cardStyle,
              borderColor: "#fcd34d",
              color: "#92400e",
              background: "#fffbeb",
            }}
          >
            {latestFailedBannerText}
          </div>
        ) : null}

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Latest batch</h2>
            {batches.length ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" }}>
                <span>Batch</span>
                <select
                  value={selectedBatchId ?? ""}
                  onChange={(event) => setSelectedBatchId(event.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }}
                >
                  {batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {formatBatchLabel(batch)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
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
              {snapshotMode === "fc" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#374151" }}>
                  <span>View</span>
                  <select
                    value={viewMode}
                    onChange={(event) => setViewMode(event.target.value as "rows" | "location")}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb" }}
                  >
                    <option value="rows">Rows</option>
                    <option value="location">By location</option>
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                onClick={handleRecomputeBatch}
                style={secondaryButtonStyle}
                disabled={!latestBatch?.id || isRematchingBatch}
              >
                {isRematchingBatch ? "Recomputing…" : "Recompute batch"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMappingsOpen(true);
                  loadMappings();
                }}
                style={secondaryButtonStyle}
              >
                View mappings
              </button>
              <label style={{ ...secondaryButtonStyle, cursor: "pointer" }}>
                {isImporting ? "Importing…" : "Import mappings CSV"}
                <input type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportFileChange} />
              </label>
              <button type="button" onClick={handleExportUnmatched} style={secondaryButtonStyle}>
                Export unmatched CSV
              </button>
            </div>
          </div>
          {importFileName ? (
            <p style={{ margin: "8px 0 0", color: "#6b7280" }}>Last import file: {importFileName}</p>
          ) : null}
          {importSummary ? <p style={{ margin: "8px 0 0", color: "#047857" }}>{importSummary}</p> : null}
          {importError ? <p style={{ margin: "8px 0 0", color: "#b91c1c" }}>{importError}</p> : null}
          {importErrors.length ? (
            <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{importErrors.length} import error(s).</strong>
                <button type="button" style={secondaryButtonStyle} onClick={handleDownloadImportErrors}>
                  Download error CSV
                </button>
              </div>
              <ul style={{ margin: "8px 0 0 16px" }}>
                {importErrors.slice(0, 8).map((row) => (
                  <li key={`${row.row_index}-${row.reason}`}>
                    Row {row.row_index}: {row.reason}
                  </li>
                ))}
                {importErrors.length > 8 ? <li>And {importErrors.length - 8} more…</li> : null}
              </ul>
            </div>
          ) : null}
          {viewMode === "location" ? (
            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              {locationGroups.length === 0 ? (
                <div style={{ color: "#6b7280" }}>
                  {latestBatch
                    ? "No rows to display."
                    : reportBatchId
                      ? "Report in progress…"
                      : "Pull a snapshot to view inventory."}
                </div>
              ) : (
                locationGroups.map((group) => (
                  <div key={group.location} style={{ ...cardStyle, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>{group.location}</h3>
                        <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                          {group.items.length} SKU group{group.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#374151" }}>
                        <span>Available: {group.available}</span>
                        <span>Inbound: {group.inbound}</span>
                        <span>Reserved: {group.reserved}</span>
                      </div>
                    </div>
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeaderCellStyle}>SKU</th>
                            <th style={tableHeaderCellStyle}>Product</th>
                            <th style={tableHeaderCellStyle}>Size</th>
                            <th style={tableHeaderCellStyle}>Color</th>
                            <th style={tableHeaderCellStyle}>External SKU count</th>
                            <th style={tableHeaderCellStyle}>Available</th>
                            <th style={tableHeaderCellStyle}>Inbound total</th>
                            <th style={tableHeaderCellStyle}>Reserved</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item) => (
                            <tr key={item.key}>
                              <td style={tableCellStyle}>{item.skuLabel}</td>
                              <td style={tableCellStyle}>{item.variantTitle || "—"}</td>
                              <td style={tableCellStyle}>{item.variantSize || "—"}</td>
                              <td style={tableCellStyle}>{item.variantColor || "—"}</td>
                              <td style={tableCellStyle}>{item.externalSkuCount}</td>
                              <td style={tableCellStyle}>{item.available}</td>
                              <td style={tableCellStyle}>{item.inbound}</td>
                              <td style={tableCellStyle}>{item.reserved}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
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
                    <th style={tableHeaderCellStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
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
                        <td style={tableCellStyle}>{row.available_qty}</td>
                        <td style={tableCellStyle}>{row.inbound_qty}</td>
                        <td style={tableCellStyle}>{row.external_location_code || row.location || "—"}</td>
                        <td style={tableCellStyle}>
                          {row.match_status === "unmatched" ? (
                            <button
                              type="button"
                              onClick={() => handleOpenMapping(row)}
                              style={{ ...secondaryButtonStyle, padding: "6px 10px", fontSize: 12 }}
                            >
                              Map
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {mappingRow ? (
          <div style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <div style={modalHeaderStyle}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Map external SKU</h3>
                  <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
                    Create or update a mapping for this Amazon SKU.
                  </p>
                </div>
                <button
                  type="button"
                  style={modalCloseStyle}
                  onClick={() => {
                    setMappingRow(null);
                    setMappingVariant(null);
                    setMappingNotes("");
                    setMappingError(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                <div style={modalGridRowStyle}>
                  <span>External SKU</span>
                  <span style={summaryValueStyle}>{mappingRow.external_sku}</span>
                </div>
                <div style={modalGridRowStyle}>
                  <span>Marketplace</span>
                  <span style={summaryValueStyle}>{mappingRow.marketplace_id || "Amazon"}</span>
                </div>
                <div style={modalGridRowStyle}>
                  <span>ASIN / FNSKU</span>
                  <span style={summaryValueStyle}>
                    {[mappingRow.asin, mappingRow.fnsku].filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
                <div>
                  <label style={modalLabelStyle}>ERP Variant</label>
                  {/* Reuse the existing ERP SKU typeahead (erp_variant_search RPC). */}
                  <VariantTypeahead value={mappingVariant} onSelect={setMappingVariant} onError={setMappingError} />
                </div>
                <div>
                  <label style={modalLabelStyle}>Notes (optional)</label>
                  <textarea
                    style={{ ...textAreaStyle, minHeight: 80 }}
                    value={mappingNotes}
                    onChange={(event) => setMappingNotes(event.target.value)}
                    placeholder="Add any notes about this mapping"
                  />
                </div>
                {mappingError ? <div style={{ color: "#b91c1c", fontSize: 13 }}>{mappingError}</div> : null}
                <div style={modalActionsStyle}>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => {
                      setMappingRow(null);
                      setMappingVariant(null);
                      setMappingNotes("");
                      setMappingError(null);
                    }}
                    disabled={mappingSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={handleSaveMapping}
                    disabled={mappingSaving}
                  >
                    {mappingSaving ? "Saving…" : "Save mapping"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {mappingsOpen ? (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalCardStyle, maxWidth: 840 }}>
              <div style={modalHeaderStyle}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: "#111827" }}>Amazon SKU mappings</h3>
                  <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
                    Review existing mappings for this company.
                  </p>
                </div>
                <button type="button" style={modalCloseStyle} onClick={() => setMappingsOpen(false)}>
                  ✕
                </button>
              </div>
              <div style={{ marginTop: 16 }}>
                {mappingsLoading ? (
                  <div style={{ color: "#6b7280" }}>Loading mappings…</div>
                ) : mappingsError ? (
                  <div style={{ color: "#b91c1c" }}>{mappingsError}</div>
                ) : mappings.length === 0 ? (
                  <div style={{ color: "#6b7280" }}>No mappings found.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={tableHeaderCellStyle}>External SKU</th>
                          <th style={tableHeaderCellStyle}>ERP SKU</th>
                          <th style={tableHeaderCellStyle}>Product</th>
                          <th style={tableHeaderCellStyle}>Size</th>
                          <th style={tableHeaderCellStyle}>Color</th>
                          <th style={tableHeaderCellStyle}>Marketplace</th>
                          <th style={tableHeaderCellStyle}>Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((mapping) => (
                          <tr key={mapping.id}>
                            <td style={tableCellStyle}>{mapping.external_sku}</td>
                            <td style={tableCellStyle}>{mapping.sku || "—"}</td>
                            <td style={tableCellStyle}>{mapping.style_code || "—"}</td>
                            <td style={tableCellStyle}>{mapping.size || "—"}</td>
                            <td style={tableCellStyle}>{mapping.color || "—"}</td>
                            <td style={tableCellStyle}>{mapping.marketplace_id || "Amazon"}</td>
                            <td style={tableCellStyle}>{mapping.active ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
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

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 640,
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.2)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const modalCloseStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 18,
  cursor: "pointer",
  color: "#6b7280",
};

const modalGridRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  fontSize: 14,
  color: "#374151",
};

const modalLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  marginBottom: 6,
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 8,
};

const textAreaStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  color: "#111827",
  fontFamily: "inherit",
  resize: "vertical",
};
