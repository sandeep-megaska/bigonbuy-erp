import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import Papa from "papaparse";
import {
  salesImportResponseSchema,
  salesImportRowSchema,
  stocktakeImportResponseSchema,
  stocktakeImportRowSchema,
  type SalesImportCsvRow,
  type SalesImportResponse,
  type StocktakeImportCsvRow,
  type StocktakeImportResponse,
} from "./csvSchemas";
import { createCsvBlob, triggerDownload } from "../csvUtils";
import {
  cardStyle,
  inputStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../erp/uiStyles";
import { supabase } from "../../../lib/supabaseClient";

const dropZoneStyle: CSSProperties = {
  border: "1px dashed #cbd5f5",
  borderRadius: 12,
  padding: "18px",
  background: "#f8fafc",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const errorBadgeStyle: CSSProperties = {
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const successBadgeStyle: CSSProperties = {
  backgroundColor: "#dcfce7",
  color: "#166534",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const modeButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "#cbd5f5",
};

const activeModeButtonStyle: CSSProperties = {
  ...modeButtonStyle,
  backgroundColor: "#1f2937",
  color: "#fff",
  borderColor: "#1f2937",
};

type WarehouseLookup = {
  id: string;
  name: string;
  code: string | null;
};

type VariantLookup = {
  id: string;
  sku: string;
};

type ChannelLookup = {
  id: string;
  code: string;
  name: string;
};

type SalesRawRow = {
  date: string;
  warehouse_code: string;
  channel_code: string;
  sku: string;
  qty: string;
  reference?: string;
  notes?: string;
};

type StocktakeRawRow = {
  date: string;
  warehouse_code: string;
  sku: string;
  counted_qty: string;
  reference?: string;
  notes?: string;
};

type SalesParsedRow = {
  rowNumber: number;
  raw: SalesRawRow;
  errors: string[];
  data: SalesImportCsvRow | null;
  resolved?: {
    warehouseId: string;
    warehouseLabel: string;
    channelId: string;
    channelLabel: string;
    variantId: string;
  };
};

type StocktakeParsedRow = {
  rowNumber: number;
  raw: StocktakeRawRow;
  errors: string[];
  data: StocktakeImportCsvRow | null;
  resolved?: {
    warehouseId: string;
    warehouseLabel: string;
    variantId: string;
  };
};

type TabId = "sales" | "stocktake";

type TabState = {
  parsedRows: Record<string, unknown>[];
  rows: SalesParsedRow[] | StocktakeParsedRow[];
  parseError: string;
  duplicateError: string;
  fileName: string;
  isParsing: boolean;
  isPosting: boolean;
  postResults: SalesImportResponse["results"] | StocktakeImportResponse["results"] | null;
  postSummary: {
    posted: number;
    errors: number;
    ok: number;
    groupCount: number;
    createdDocIds: string[];
  } | null;
  validateOnly: boolean;
};

const normalizeValue = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const buildDuplicateKey = (parts: Array<string | undefined>) =>
  parts.map((part) => (part ? part.trim().toUpperCase() : "")).join("::");

export default function TabbedCsvImport({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("sales");
  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);
  const [variants, setVariants] = useState<VariantLookup[]>([]);
  const [channels, setChannels] = useState<ChannelLookup[]>([]);
  const [state, setState] = useState<Record<TabId, TabState>>({
    sales: {
      parsedRows: [],
      rows: [],
      parseError: "",
      duplicateError: "",
      fileName: "",
      isParsing: false,
      isPosting: false,
      postResults: null,
      postSummary: null,
      validateOnly: false,
    },
    stocktake: {
      parsedRows: [],
      rows: [],
      parseError: "",
      duplicateError: "",
      fileName: "",
      isParsing: false,
      isPosting: false,
      postResults: null,
      postSummary: null,
      validateOnly: false,
    },
  });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const [warehouseRes, variantRes, channelRes] = await Promise.all([
        supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId),
        supabase.from("erp_variants").select("id, sku").eq("company_id", companyId),
        supabase.from("erp_sales_channels").select("id, code, name").eq("company_id", companyId),
      ]);

      if (!active) return;
      if (warehouseRes.error || variantRes.error || channelRes.error) {
        setState((prev) => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            parseError:
              warehouseRes.error?.message ||
              variantRes.error?.message ||
              channelRes.error?.message ||
              "Failed to load warehouse, SKU, or channel data.",
          },
        }));
        return;
      }

      setWarehouses((warehouseRes.data || []) as WarehouseLookup[]);
      setVariants((variantRes.data || []) as VariantLookup[]);
      setChannels((channelRes.data || []) as ChannelLookup[]);
    })();

    return () => {
      active = false;
    };
  }, [companyId, activeTab]);

  const warehouseCodeMap = useMemo(() => {
    const map = new Map<string, WarehouseLookup>();
    warehouses.forEach((warehouse) => {
      if (warehouse.code) map.set(warehouse.code.toLowerCase(), warehouse);
    });
    return map;
  }, [warehouses]);

  const variantSkuMap = useMemo(() => {
    const map = new Map<string, VariantLookup>();
    variants.forEach((variant) => {
      map.set(variant.sku.toLowerCase(), variant);
    });
    return map;
  }, [variants]);

  const channelCodeMap = useMemo(() => {
    const map = new Map<string, ChannelLookup>();
    channels.forEach((channel) => {
      map.set(channel.code.toLowerCase(), channel);
    });
    return map;
  }, [channels]);

  const updateTabState = useCallback(
    (tabId: TabId, updater: (prev: TabState) => TabState) => {
      setState((prev) => ({
        ...prev,
        [tabId]: updater(prev[tabId]),
      }));
    },
    []
  );

  const resetImportState = useCallback(
    (tabId: TabId) => {
      updateTabState(tabId, (prev) => ({
        ...prev,
        rows: [],
        parsedRows: [],
        postResults: null,
        postSummary: null,
        parseError: "",
        duplicateError: "",
        fileName: "",
      }));
    },
    [updateTabState]
  );

  const buildSalesRows = useCallback(
    (parsed: Record<string, unknown>[]) => {
      const baseRows: SalesParsedRow[] = parsed.map((row, index) => {
        const raw: SalesRawRow = {
          date: normalizeValue(row.date),
          warehouse_code: normalizeValue(row.warehouse_code),
          channel_code: normalizeValue(row.channel_code),
          sku: normalizeValue(row.sku),
          qty: normalizeValue(row.qty),
          reference: normalizeValue(row.reference),
          notes: normalizeValue(row.notes),
        };
        const result = salesImportRowSchema.safeParse(raw);
        const errors = result.success
          ? []
          : result.error.issues.map((issue: { message: string }) => issue.message);
        return {
          rowNumber: index + 2,
          raw,
          errors,
          data: result.success ? result.data : null,
        } as SalesParsedRow;
      });

      const resolvedRows = baseRows.map((row) => {
        if (!row.data) return row;
        const warehouseKey = row.raw.warehouse_code.toLowerCase();
        const channelKey = row.raw.channel_code.toLowerCase();
        const skuKey = row.raw.sku.toLowerCase();
        const warehouseMatch = warehouseCodeMap.get(warehouseKey) ?? null;
        const channelMatch = channelCodeMap.get(channelKey) ?? null;
        const variantMatch = variantSkuMap.get(skuKey) ?? null;
        const errors = [...row.errors];

        if (!warehouseMatch) errors.push("Unknown warehouse code.");
        if (!channelMatch) errors.push("Unknown channel code.");
        if (!variantMatch) errors.push("Unknown SKU.");

        return {
          ...row,
          errors,
          resolved:
            warehouseMatch && channelMatch && variantMatch
              ? {
                  warehouseId: warehouseMatch.id,
                  warehouseLabel: warehouseMatch.code || warehouseMatch.name,
                  channelId: channelMatch.id,
                  channelLabel: channelMatch.name,
                  variantId: variantMatch.id,
                }
              : undefined,
        };
      });

      const duplicateMap = new Map<string, number[]>();
      resolvedRows.forEach((row, index) => {
        const normalizedDate = row.data?.date ?? todayDate();
        const key = buildDuplicateKey([
          normalizedDate,
          row.raw.warehouse_code,
          row.raw.channel_code,
          row.raw.sku,
        ]);
        if (!key.replace(/::/g, "")) return;
        const existing = duplicateMap.get(key) ?? [];
        existing.push(index);
        duplicateMap.set(key, existing);
      });

      const dedupedRows = resolvedRows.map((row, index) => {
        const normalizedDate = row.data?.date ?? todayDate();
        const key = buildDuplicateKey([
          normalizedDate,
          row.raw.warehouse_code,
          row.raw.channel_code,
          row.raw.sku,
        ]);
        const duplicates = duplicateMap.get(key);
        if (!duplicates || duplicates.length < 2) return row;
        return {
          ...row,
          errors: Array.from(new Set([...row.errors, "Duplicate row for date+warehouse+channel+sku"])),
        };
      });

      const hasDuplicates = dedupedRows.some((row) =>
        row.errors.includes("Duplicate row for date+warehouse+channel+sku")
      );

      updateTabState("sales", (prev) => ({
        ...prev,
        rows: dedupedRows,
        duplicateError: hasDuplicates ? "Duplicate rows detected in upload" : "",
      }));
    },
    [channelCodeMap, updateTabState, variantSkuMap, warehouseCodeMap]
  );

  const buildStocktakeRows = useCallback(
    (parsed: Record<string, unknown>[]) => {
      const baseRows: StocktakeParsedRow[] = parsed.map((row, index) => {
        const raw: StocktakeRawRow = {
          date: normalizeValue(row.date),
          warehouse_code: normalizeValue(row.warehouse_code),
          sku: normalizeValue(row.sku),
          counted_qty: normalizeValue(row.counted_qty),
          reference: normalizeValue(row.reference),
          notes: normalizeValue(row.notes),
        };
        const result = stocktakeImportRowSchema.safeParse(raw);
        const errors = result.success
          ? []
          : result.error.issues.map((issue: { message: string }) => issue.message);
        return {
          rowNumber: index + 2,
          raw,
          errors,
          data: result.success ? result.data : null,
        } as StocktakeParsedRow;
      });

      const resolvedRows = baseRows.map((row) => {
        if (!row.data) return row;
        const warehouseKey = row.raw.warehouse_code.toLowerCase();
        const skuKey = row.raw.sku.toLowerCase();
        const warehouseMatch = warehouseCodeMap.get(warehouseKey) ?? null;
        const variantMatch = variantSkuMap.get(skuKey) ?? null;
        const errors = [...row.errors];

        if (!warehouseMatch) errors.push("Unknown warehouse code.");
        if (!variantMatch) errors.push("Unknown SKU.");

        return {
          ...row,
          errors,
          resolved:
            warehouseMatch && variantMatch
              ? {
                  warehouseId: warehouseMatch.id,
                  warehouseLabel: warehouseMatch.code || warehouseMatch.name,
                  variantId: variantMatch.id,
                }
              : undefined,
        };
      });

      const duplicateMap = new Map<string, number[]>();
      resolvedRows.forEach((row, index) => {
        const normalizedDate = row.data?.date ?? todayDate();
        const key = buildDuplicateKey([normalizedDate, row.raw.warehouse_code, row.raw.sku]);
        if (!key.replace(/::/g, "")) return;
        const existing = duplicateMap.get(key) ?? [];
        existing.push(index);
        duplicateMap.set(key, existing);
      });

      const dedupedRows = resolvedRows.map((row, index) => {
        const normalizedDate = row.data?.date ?? todayDate();
        const key = buildDuplicateKey([normalizedDate, row.raw.warehouse_code, row.raw.sku]);
        const duplicates = duplicateMap.get(key);
        if (!duplicates || duplicates.length < 2) return row;
        return {
          ...row,
          errors: Array.from(new Set([...row.errors, "Duplicate row for date+warehouse+sku"])),
        };
      });

      const hasDuplicates = dedupedRows.some((row) => row.errors.includes("Duplicate row for date+warehouse+sku"));

      updateTabState("stocktake", (prev) => ({
        ...prev,
        rows: dedupedRows,
        duplicateError: hasDuplicates ? "Duplicate rows detected in upload" : "",
      }));
    },
    [updateTabState, variantSkuMap, warehouseCodeMap]
  );

  useEffect(() => {
    if (!state.sales.parsedRows.length) return;
    buildSalesRows(state.sales.parsedRows);
  }, [buildSalesRows, state.sales.parsedRows]);

  useEffect(() => {
    if (!state.stocktake.parsedRows.length) return;
    buildStocktakeRows(state.stocktake.parsedRows);
  }, [buildStocktakeRows, state.stocktake.parsedRows]);

  const handleFile = useCallback(
    (tabId: TabId, file: File) => {
      updateTabState(tabId, (prev) => ({
        ...prev,
        isParsing: true,
        parseError: "",
        postResults: null,
        postSummary: null,
      }));
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (results) => {
          updateTabState(tabId, (prev) => ({
            ...prev,
            isParsing: false,
            fileName: file.name,
          }));
          if (results.errors?.length) {
            updateTabState(tabId, (prev) => ({
              ...prev,
              parseError: results.errors[0]?.message || "Failed to parse CSV.",
            }));
            return;
          }
          updateTabState(tabId, (prev) => ({
            ...prev,
            parsedRows: results.data || [],
          }));
        },
        error: (error) => {
          updateTabState(tabId, (prev) => ({
            ...prev,
            isParsing: false,
            parseError: error.message || "Failed to parse CSV.",
          }));
        },
      });
    },
    [updateTabState]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) handleFile(activeTab, file);
    },
    [activeTab, handleFile]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleFile(activeTab, file);
      event.target.value = "";
    },
    [activeTab, handleFile]
  );

  const downloadTemplate = useCallback((tabId: TabId) => {
    const headers =
      tabId === "sales"
        ? ["date", "warehouse_code", "channel_code", "sku", "qty", "reference", "notes"]
        : ["date", "warehouse_code", "sku", "counted_qty", "reference", "notes"];
    const content = `${headers.join(",")}\n`;
    const blob = createCsvBlob(content);
    triggerDownload(`inventory-${tabId}-template.csv`, blob);
  }, []);

  const downloadInvalidRows = useCallback(
    (tabId: TabId) => {
      const tabRows = state[tabId].rows;
      const invalidRows = tabRows.filter((row) => row.errors.length > 0);
      if (!invalidRows.length) return;
      const csvData = invalidRows.map((row) => {
        if (tabId === "sales") {
          const salesRow = row as SalesParsedRow;
          return {
            date: salesRow.raw.date,
            warehouse_code: salesRow.raw.warehouse_code,
            channel_code: salesRow.raw.channel_code,
            sku: salesRow.raw.sku,
            qty: salesRow.raw.qty,
            reference: salesRow.raw.reference ?? "",
            notes: salesRow.raw.notes ?? "",
            errors: salesRow.errors.join(" | "),
          };
        }
        const stocktakeRow = row as StocktakeParsedRow;
        return {
          date: stocktakeRow.raw.date,
          warehouse_code: stocktakeRow.raw.warehouse_code,
          sku: stocktakeRow.raw.sku,
          counted_qty: stocktakeRow.raw.counted_qty,
          reference: stocktakeRow.raw.reference ?? "",
          notes: stocktakeRow.raw.notes ?? "",
          errors: stocktakeRow.errors.join(" | "),
        };
      });
      const csv = Papa.unparse(csvData, { quotes: false });
      const blob = createCsvBlob(csv);
      triggerDownload(`inventory-${tabId}-invalid-rows.csv`, blob);
    },
    [state]
  );

  const commitSales = useCallback(async () => {
    const tabState = state.sales;
    const rows = tabState.rows as SalesParsedRow[];
    updateTabState("sales", (prev) => ({ ...prev, isPosting: true, parseError: "" }));

    const payload = rows
      .filter((row) => row.data)
      .map((row) => ({
        date: row.data?.date ?? null,
        warehouse_code: row.raw.warehouse_code,
        channel_code: row.raw.channel_code,
        sku: row.raw.sku,
        qty: row.data?.qty,
        reference: row.data?.reference ?? null,
        notes: row.data?.notes ?? null,
      }));

    const { data, error } = await supabase.rpc("erp_sales_consumption_import_csv", {
      p_rows: payload,
      p_validate_only: tabState.validateOnly,
    });

    if (error) {
      updateTabState("sales", (prev) => ({
        ...prev,
        isPosting: false,
        parseError: error.message || "Failed to post sales consumption import.",
      }));
      return;
    }

    const parsed = salesImportResponseSchema.safeParse(data);
    if (!parsed.success) {
      updateTabState("sales", (prev) => ({
        ...prev,
        isPosting: false,
        parseError: "Unexpected response from sales consumption import.",
      }));
      return;
    }

    const okCount = parsed.data.results.filter((result) => result.ok).length;
    updateTabState("sales", (prev) => ({
      ...prev,
      postResults: parsed.data.results,
      postSummary: {
        posted: parsed.data.posted_count,
        errors: parsed.data.error_count,
        ok: okCount,
        groupCount: parsed.data.group_count,
        createdDocIds: parsed.data.created_doc_ids,
      },
      isPosting: false,
    }));
  }, [state.sales, updateTabState]);

  const commitStocktake = useCallback(async () => {
    const tabState = state.stocktake;
    const rows = tabState.rows as StocktakeParsedRow[];
    updateTabState("stocktake", (prev) => ({ ...prev, isPosting: true, parseError: "" }));

    const payload = rows
      .filter((row) => row.data)
      .map((row) => ({
        date: row.data?.date ?? null,
        warehouse_code: row.raw.warehouse_code,
        sku: row.raw.sku,
        counted_qty: row.data?.counted_qty,
        reference: row.data?.reference ?? null,
        notes: row.data?.notes ?? null,
      }));

    const { data, error } = await supabase.rpc("erp_stocktake_import_csv", {
      p_rows: payload,
      p_validate_only: tabState.validateOnly,
    });

    if (error) {
      updateTabState("stocktake", (prev) => ({
        ...prev,
        isPosting: false,
        parseError: error.message || "Failed to post stocktake import.",
      }));
      return;
    }

    const parsed = stocktakeImportResponseSchema.safeParse(data);
    if (!parsed.success) {
      updateTabState("stocktake", (prev) => ({
        ...prev,
        isPosting: false,
        parseError: "Unexpected response from stocktake import.",
      }));
      return;
    }

    const okCount = parsed.data.results.filter((result) => result.ok).length;
    updateTabState("stocktake", (prev) => ({
      ...prev,
      postResults: parsed.data.results,
      postSummary: {
        posted: parsed.data.posted_count,
        errors: parsed.data.error_count,
        ok: okCount,
        groupCount: parsed.data.group_count,
        createdDocIds: parsed.data.created_doc_ids,
      },
      isPosting: false,
    }));
  }, [state.stocktake, updateTabState]);

  const activeState = state[activeTab];

  const stats = useMemo(() => {
    const total = activeState.rows.length;
    const invalid = activeState.rows.filter((row) => row.errors.length > 0).length;
    return {
      total,
      invalid,
      valid: total - invalid,
    };
  }, [activeState.rows]);

  const canCommit = useMemo(() => {
    if (!canWrite) return false;
    if (!activeState.rows.length) return false;
    return activeState.rows.every((row) => row.errors.length === 0 && row.resolved);
  }, [activeState.rows, canWrite]);

  const handleCommit = useCallback(() => {
    if (!canCommit) return;
    if (activeTab === "sales") {
      commitSales();
    } else {
      commitStocktake();
    }
  }, [activeTab, canCommit, commitSales, commitStocktake]);

  return (
    <section style={cardStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>CSV Import</h2>
          <p style={{ color: "#475569", margin: 0 }}>
            {activeTab === "sales"
              ? "Upload a sales consumption CSV to post stock-out entries."
              : "Upload a stocktake CSV to capture counted quantities."}
          </p>
        </div>
        <button type="button" onClick={() => resetImportState(activeTab)} style={secondaryButtonStyle}>
          Reset
        </button>
      </header>

      {!canWrite ? (
        <p style={{ color: "#991b1b", fontWeight: 600 }}>Only owner/admin can commit stock imports.</p>
      ) : null}

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <button
          type="button"
          style={activeTab === "sales" ? activeModeButtonStyle : modeButtonStyle}
          onClick={() => setActiveTab("sales")}
        >
          Sales Consumption CSV
        </button>
        <button
          type="button"
          style={activeTab === "stocktake" ? activeModeButtonStyle : modeButtonStyle}
          onClick={() => setActiveTab("stocktake")}
        >
          Stocktake CSV
        </button>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        <div
          style={{
            ...dropZoneStyle,
            border: isDragging ? "1px dashed #6366f1" : "1px dashed #cbd5f5",
            background: isDragging ? "#eef2ff" : dropZoneStyle.background,
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <strong>{activeState.fileName || "Drag & drop CSV file"}</strong>
          <span style={{ color: "#64748b" }}>
            Or browse to upload the {activeTab === "sales" ? "sales consumption" : "stocktake"} CSV template.
          </span>
          <input type="file" accept=".csv" onChange={handleFileChange} style={inputStyle} />
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => downloadTemplate(activeTab)} style={secondaryButtonStyle}>
            Download {activeTab === "sales" ? "Sales" : "Stocktake"} Template
          </button>
        </div>
      </div>

      {activeState.parseError ? <div style={{ color: "#b91c1c", marginTop: 12 }}>{activeState.parseError}</div> : null}
      {activeState.duplicateError ? (
        <div style={{ color: "#b91c1c", marginTop: 12, fontWeight: 600 }}>{activeState.duplicateError}</div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={activeState.validateOnly}
            onChange={(event) =>
              updateTabState(activeTab, (prev) => ({ ...prev, validateOnly: event.target.checked }))
            }
          />
          <span>Validate only (no stock changes)</span>
        </label>
        <span style={{ color: "#64748b", fontSize: 12 }}>
          Runs validation + resolution + delta calculation. Does not post ledger entries.
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <span style={successBadgeStyle}>Total: {stats.total}</span>
        <span style={successBadgeStyle}>Valid: {stats.valid}</span>
        <span style={errorBadgeStyle}>Invalid: {stats.invalid}</span>
        {stats.invalid > 0 ? (
          <button type="button" onClick={() => downloadInvalidRows(activeTab)} style={secondaryButtonStyle}>
            Download invalid rows
          </button>
        ) : null}
      </div>

      {activeState.isParsing ? <p style={{ marginTop: 12 }}>Parsing CSV…</p> : null}

      {activeState.rows.length ? (
        <section style={{ ...tableStyle, marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Row</th>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                {activeTab === "sales" ? <th style={tableHeaderCellStyle}>Channel</th> : null}
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>{activeTab === "sales" ? "Qty" : "Counted Qty"}</th>
                <th style={tableHeaderCellStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {activeState.rows.map((row) => (
                <tr key={`${row.rowNumber}-${row.raw.sku}`}>
                  <td style={tableCellStyle}>{row.rowNumber}</td>
                  <td style={tableCellStyle}>{row.raw.date || todayDate()}</td>
                  <td style={tableCellStyle}>{row.raw.warehouse_code || "—"}</td>
                  {activeTab === "sales" ? (
                    <td style={tableCellStyle}>{(row as SalesParsedRow).raw.channel_code || "—"}</td>
                  ) : null}
                  <td style={tableCellStyle}>{row.raw.sku || "—"}</td>
                  <td style={tableCellStyle}>
                    {activeTab === "sales"
                      ? (row as SalesParsedRow).raw.qty || "—"
                      : (row as StocktakeParsedRow).raw.counted_qty || "—"}
                  </td>
                  <td style={tableCellStyle}>
                    {row.errors.length === 0 ? (
                      <span style={successBadgeStyle}>Ready</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={errorBadgeStyle}>Invalid</span>
                        <ul style={{ margin: 0, paddingLeft: 16, color: "#b91c1c" }}>
                          {row.errors.map((error, index) => (
                            <li key={`${row.rowNumber}-error-${index}`}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleCommit}
          style={primaryButtonStyle}
          disabled={!canCommit || activeState.isPosting}
        >
          {activeState.isPosting ? "Posting…" : activeState.validateOnly ? "Validate Import" : "Commit Import"}
        </button>
        {!canCommit && activeState.rows.length ? (
          <span style={{ color: "#b91c1c", fontWeight: 600 }}>Resolve all errors to continue.</span>
        ) : null}
      </div>

      {activeState.postSummary ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8, fontSize: 16 }}>Import Summary</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span style={successBadgeStyle}>OK: {activeState.postSummary.ok}</span>
            <span style={successBadgeStyle}>Posted: {activeState.postSummary.posted}</span>
            <span style={errorBadgeStyle}>Errors: {activeState.postSummary.errors}</span>
            <span style={successBadgeStyle}>
              {activeState.validateOnly ? "Would create" : "Documents"}: {activeState.postSummary.groupCount}
            </span>
          </div>
          {activeState.validateOnly ? null : activeState.postSummary.createdDocIds.length ? (
            <div style={{ marginTop: 8, color: "#475569" }}>
              Created doc IDs: {activeState.postSummary.createdDocIds.join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeState.postResults?.length ? (
        <section style={{ ...tableStyle, marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Row</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Message</th>
                {activeTab === "stocktake" ? (
                  <>
                    <th style={tableHeaderCellStyle}>On Hand</th>
                    <th style={tableHeaderCellStyle}>Counted Qty</th>
                    <th style={tableHeaderCellStyle}>Delta</th>
                    <th style={tableHeaderCellStyle}>Ledger Type</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {activeState.postResults.map((result) => (
                <tr key={`result-${result.row_index}`}>
                  <td style={tableCellStyle}>{result.row_index}</td>
                  <td style={tableCellStyle}>
                    {result.ok ? <span style={successBadgeStyle}>OK</span> : <span style={errorBadgeStyle}>Error</span>}
                  </td>
                  <td style={tableCellStyle}>{result.message || "—"}</td>
                  {activeTab === "stocktake" ? (
                    <>
                      {(() => {
                        const stocktakeResult = result as StocktakeImportResponse["results"][number];

                        return (
                          <>
                            <td style={tableCellStyle}>{stocktakeResult.on_hand ?? "—"}</td>
                            <td style={tableCellStyle}>{stocktakeResult.counted_qty ?? "—"}</td>
                            <td style={tableCellStyle}>{stocktakeResult.delta ?? "—"}</td>
                            <td style={tableCellStyle}>{stocktakeResult.ledger_type ?? "—"}</td>
                          </>
                        );
                      })()}
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
