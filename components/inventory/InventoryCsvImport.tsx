import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import Papa from "papaparse";
import {
  adjustmentRowSchema,
  fbaRowSchema,
  importResponseSchema,
  stocktakeRowSchema,
  type AdjustmentCsvRow,
  type FbaCsvRow,
  type ImportMode,
  type ImportResponse,
  type StocktakeCsvRow,
} from "./csvSchemas";
import { createCsvBlob, triggerDownload } from "./csvUtils";
import {
  cardStyle,
  inputStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../erp/uiStyles";
import { supabase } from "../../lib/supabaseClient";

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

type WarehouseLookup = {
  id: string;
  name: string;
  code: string | null;
};

type VariantLookup = {
  id: string;
  sku: string;
};

type BaseParsedRow = {
  rowNumber: number;
  raw: {
    warehouse_code: string;
    sku: string;
    qty_delta?: string;
    counted_qty?: string;
    amazon_fulfillable_qty?: string;
    reason?: string;
    reference?: string;
  };
  errors: string[];
  data: AdjustmentCsvRow | StocktakeCsvRow | FbaCsvRow | null;
  resolved?: {
    warehouseId: string;
    warehouseLabel: string;
    variantId: string;
  };
};

type ImportResult = ImportResponse["results"][number];

const FBA_WAREHOUSE_IDS = [
  "d2c5c23b-ce0f-4d9d-8563-a0e507063700",
  "5d62c01b-91b6-41de-b45a-2a8ca1637c4c",
  "abefd510-2006-4d23-b563-32de06084475",
  "1318d03a-a62e-4c17-bcc2-16a8ac49b743",
];

const defaultReasonMap: Record<ImportMode, string> = {
  adjustment: "CSV Import",
  stocktake: "Stocktake CSV",
  fba: "FBA Reconciliation",
};

const schemaMap = {
  adjustment: adjustmentRowSchema,
  stocktake: stocktakeRowSchema,
  fba: fbaRowSchema,
} as const;

const normalizeValue = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
};

export default function InventoryCsvImport({
  mode,
  companyId,
  canWrite,
}: {
  mode: ImportMode;
  companyId: string;
  canWrite: boolean;
}) {
  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);
  const [variants, setVariants] = useState<VariantLookup[]>([]);
  const [rows, setRows] = useState<BaseParsedRow[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState<string>("");
  const [duplicateError, setDuplicateError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [isParsing, setIsParsing] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [postResults, setPostResults] = useState<ImportResult[] | null>(null);
  const [postSummary, setPostSummary] = useState<{ posted: number; errors: number; ok: number } | null>(null);
  const [validateOnly, setValidateOnly] = useState(false);
  const [selectedFbaWarehouseId, setSelectedFbaWarehouseId] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const [warehouseRes, variantRes] = await Promise.all([
        supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId),
        supabase.from("erp_variants").select("id, sku").eq("company_id", companyId),
      ]);

      if (!active) return;
      if (warehouseRes.error || variantRes.error) {
        setParseError(
          warehouseRes.error?.message || variantRes.error?.message || "Failed to load warehouse or SKU data."
        );
        return;
      }

      setWarehouses((warehouseRes.data || []) as WarehouseLookup[]);
      setVariants((variantRes.data || []) as VariantLookup[]);
    })();

    return () => {
      active = false;
    };
  }, [companyId]);

  const warehouseCodeMap = useMemo(() => {
    const map = new Map<string, WarehouseLookup>();
    warehouses.forEach((warehouse) => {
      if (warehouse.code) map.set(warehouse.code.toLowerCase(), warehouse);
    });
    return map;
  }, [warehouses]);

  const warehouseNameMap = useMemo(() => {
    const map = new Map<string, WarehouseLookup>();
    warehouses.forEach((warehouse) => {
      map.set(warehouse.name.toLowerCase(), warehouse);
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

  const fbaWarehouses = useMemo(
    () => warehouses.filter((warehouse) => FBA_WAREHOUSE_IDS.includes(warehouse.id)),
    [warehouses]
  );

  const stats = useMemo(() => {
    const total = rows.length;
    const invalid = rows.filter((row) => row.errors.length > 0).length;
    return {
      total,
      invalid,
      valid: total - invalid,
    };
  }, [rows]);

  const canCommit = useMemo(() => {
    if (!canWrite) return false;
    if (!rows.length) return false;
    return rows.every((row) => row.errors.length === 0 && row.resolved);
  }, [canWrite, rows]);

  const resetImportState = useCallback(() => {
    setRows([]);
    setParsedRows([]);
    setPostResults(null);
    setPostSummary(null);
    setParseError("");
    setDuplicateError("");
    setFileName("");
  }, []);

  const buildRows = useCallback(
    (parsed: Record<string, unknown>[]) => {
      const schema = schemaMap[mode];
      setDuplicateError("");
      const baseRows = parsed.map((row, index) => {
        const raw = {
          warehouse_code: mode === "fba" ? normalizeValue(row.warehouse_code || "") : normalizeValue(row.warehouse_code),
          sku: normalizeValue(row.sku),
          qty_delta: normalizeValue(row.qty_delta),
          counted_qty: normalizeValue(row.counted_qty),
          amazon_fulfillable_qty: normalizeValue(row.amazon_fulfillable_qty),
          reason: normalizeValue(row.reason),
          reference: normalizeValue(row.reference),
        };
        const result = schema.safeParse(raw);
        const errors = result.success
          ? []
          : result.error.issues.map((issue: { message: string }) => issue.message);
        return {
          rowNumber: index + 2,
          raw,
          errors,
          data: result.success ? result.data : null,
        } as BaseParsedRow;
      });

      const resolvedRows = baseRows.map((row) => {
        if (!row.data) return row;
        const warehouseKey = row.raw.warehouse_code.toLowerCase();
        const skuKey = row.raw.sku.toLowerCase();
        const warehouseMatch =
          mode === "fba"
            ? fbaWarehouses.find((warehouse) => warehouse.id === selectedFbaWarehouseId) ?? null
            : warehouseCodeMap.get(warehouseKey) ?? warehouseNameMap.get(warehouseKey);
        const variantMatch = variantSkuMap.get(skuKey);
        const errors = [...row.errors];

        if (!warehouseMatch) {
          errors.push(mode === "fba" ? "Missing FBA warehouse selection." : "Unknown warehouse code/name.");
        }
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
        const warehouseKey =
          mode === "fba"
            ? selectedFbaWarehouseId.trim().toUpperCase()
            : row.raw.warehouse_code.trim().toUpperCase();
        const skuKey = row.raw.sku.trim().toUpperCase();
        if (!warehouseKey || !skuKey) return;
        const key = `${warehouseKey}::${skuKey}`;
        const existing = duplicateMap.get(key) ?? [];
        existing.push(index);
        duplicateMap.set(key, existing);
      });

      const dedupedRows = resolvedRows.map((row, index) => {
        const duplicates = duplicateMap.get(
          `${mode === "fba" ? selectedFbaWarehouseId.trim().toUpperCase() : row.raw.warehouse_code.trim().toUpperCase()}::${row.raw.sku.trim().toUpperCase()}`
        );
        if (!duplicates || duplicates.length < 2) return row;
        return {
          ...row,
          errors: Array.from(new Set([...row.errors, "Duplicate row: warehouse_code + sku repeated"])),
        };
      });

      if (dedupedRows.some((row) => row.errors.includes("Duplicate row: warehouse_code + sku repeated"))) {
        setDuplicateError("Duplicate SKU rows detected in upload");
      }

      setRows(dedupedRows);
    },
    [mode, warehouseCodeMap, warehouseNameMap, variantSkuMap, fbaWarehouses, selectedFbaWarehouseId]
  );

  useEffect(() => {
    if (!parsedRows.length) return;
    buildRows(parsedRows);
  }, [buildRows, parsedRows]);

  const handleFile = useCallback(
    (file: File) => {
      setIsParsing(true);
      setParseError("");
      setPostResults(null);
      setPostSummary(null);
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (results) => {
          setIsParsing(false);
          if (results.errors?.length) {
            setParseError(results.errors[0]?.message || "Failed to parse CSV.");
            return;
          }
          setFileName(file.name);
          setParsedRows(results.data || []);
        },
        error: (error) => {
          setIsParsing(false);
          setParseError(error.message || "Failed to parse CSV.");
        },
      });
    },
    [buildRows]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleFile(file);
      event.target.value = "";
    },
    [handleFile]
  );

  const downloadInvalidRows = useCallback(() => {
    const invalidRows = rows.filter((row) => row.errors.length > 0);
    if (!invalidRows.length) return;
    const csvData = invalidRows.map((row) => ({
      warehouse_code: mode === "fba" ? selectedFbaWarehouseId : row.raw.warehouse_code,
      sku: row.raw.sku,
      qty_delta: row.raw.qty_delta ?? "",
      counted_qty: row.raw.counted_qty ?? "",
      amazon_fulfillable_qty: row.raw.amazon_fulfillable_qty ?? "",
      reason: row.raw.reason ?? "",
      reference: row.raw.reference ?? "",
      errors: row.errors.join(" | "),
    }));
    const csv = Papa.unparse(csvData, { quotes: false });
    const blob = createCsvBlob(csv);
    triggerDownload(`inventory-${mode}-invalid-rows.csv`, blob);
  }, [mode, rows, selectedFbaWarehouseId]);

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    setIsPosting(true);
    setParseError("");
    setPostResults(null);
    setPostSummary(null);

    const payload = rows.map((row) => {
      if (!row.data) return null;
      const base = {
        warehouse_code: mode === "fba" ? undefined : row.raw.warehouse_code,
        sku: row.raw.sku,
        reason: row.data.reason || defaultReasonMap[mode],
        reference: row.data.reference || null,
      };
      if (mode === "adjustment") {
        return {
          ...base,
          qty_delta: (row.data as AdjustmentCsvRow).qty_delta,
        };
      }
      if (mode === "stocktake") {
        return {
          ...base,
          counted_qty: (row.data as StocktakeCsvRow).counted_qty,
        };
      }
      return {
        ...base,
        amazon_fulfillable_qty: (row.data as FbaCsvRow).amazon_fulfillable_qty,
      };
    });

    const rowsPayload = payload.filter(Boolean) as Array<Record<string, unknown>>;
    const rpcName =
      mode === "adjustment"
        ? "erp_inventory_adjustments_import"
        : mode === "stocktake"
          ? "erp_inventory_stocktake_import"
          : "erp_inventory_fba_reconcile_import";
    const rpcPayload =
      mode === "fba"
        ? { p_warehouse_id: selectedFbaWarehouseId, p_rows: rowsPayload, p_validate_only: validateOnly }
        : { p_rows: rowsPayload, p_validate_only: validateOnly };
    const { data, error } = await supabase.rpc(rpcName, rpcPayload);

    if (error) {
      setParseError(error.message || "Failed to post inventory import.");
      setIsPosting(false);
      return;
    }

    const parsed = importResponseSchema.safeParse(data);
    if (!parsed.success) {
      setParseError("Unexpected response from inventory import.");
      setIsPosting(false);
      return;
    }

    const okCount = parsed.data.results.filter((result) => result.ok).length;
    setPostResults(parsed.data.results);
    setPostSummary({ posted: parsed.data.posted_count, errors: parsed.data.error_count, ok: okCount });
    setIsPosting(false);
  }, [canCommit, mode, rows, selectedFbaWarehouseId, validateOnly]);

  const downloadTemplate = useCallback(
    (type: "adjustment" | "stocktake") => {
      const headers =
        type === "adjustment"
          ? ["warehouse_code", "sku", "qty_delta", "reason", "reference"]
          : ["warehouse_code", "sku", "counted_qty", "reason", "reference"];
      const content = `${headers.join(",")}\n`;
      const blob = createCsvBlob(content);
      triggerDownload(`inventory-${type}-template.csv`, blob);
    },
    []
  );

  const downloadFbaTemplate = useCallback(() => {
    const headers = ["sku", "amazon_fulfillable_qty", "reason", "reference"];
    const content = `${headers.join(",")}\n`;
    const blob = createCsvBlob(content);
    triggerDownload("inventory-fba-reconciliation-template.csv", blob);
  }, []);

  const showResultsTable = postResults?.length;

  return (
    <section style={cardStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>CSV Import</h2>
          <p style={{ color: "#475569", margin: 0 }}>
            {mode === "adjustment"
              ? "Upload a CSV to post adjustments."
              : mode === "stocktake"
                ? "Upload a CSV to capture stocktake counts."
                : "Upload a CSV to reconcile Amazon FBA stock counts."}
          </p>
        </div>
        <button type="button" onClick={resetImportState} style={secondaryButtonStyle}>
          Reset
        </button>
      </header>

      {!canWrite ? (
        <p style={{ color: "#991b1b", fontWeight: 600 }}>Only owner/admin can commit stock imports.</p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          <strong>{fileName || "Drag & drop CSV file"}</strong>
          <span style={{ color: "#64748b" }}>Or browse to upload the {mode} CSV template.</span>
          <input type="file" accept=".csv" onChange={handleFileChange} style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => downloadTemplate("adjustment")} style={secondaryButtonStyle}>
            Download Adjustment Template
          </button>
          <button type="button" onClick={() => downloadTemplate("stocktake")} style={secondaryButtonStyle}>
            Download Stocktake Template
          </button>
          {mode === "fba" ? (
            <button type="button" onClick={downloadFbaTemplate} style={secondaryButtonStyle}>
              Download FBA Template
            </button>
          ) : null}
        </div>
      </div>

      {parseError ? <div style={{ color: "#b91c1c", marginTop: 12 }}>{parseError}</div> : null}
      {duplicateError ? (
        <div style={{ color: "#b91c1c", marginTop: 12, fontWeight: 600 }}>{duplicateError}</div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={validateOnly}
            onChange={(event) => setValidateOnly(event.target.checked)}
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
          <button type="button" onClick={downloadInvalidRows} style={secondaryButtonStyle}>
            Download invalid rows
          </button>
        ) : null}
      </div>

      {isParsing ? <p style={{ marginTop: 12 }}>Parsing CSV…</p> : null}

      {mode === "fba" ? (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 600 }}>
            Amazon FBA Warehouse
            <select
              value={selectedFbaWarehouseId}
              onChange={(event) => {
                setSelectedFbaWarehouseId(event.target.value);
                if (parsedRows.length) {
                  buildRows(parsedRows);
                }
              }}
              style={{ ...inputStyle, maxWidth: 360 }}
            >
              <option value="">Select FBA warehouse</option>
              {fbaWarehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} {warehouse.code ? `(${warehouse.code})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {rows.length ? (
        <section style={{ ...tableStyle, marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Row</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>
                  {mode === "adjustment"
                    ? "Qty Delta"
                    : mode === "stocktake"
                      ? "Counted Qty"
                      : "Amazon Fulfillable Qty"}
                </th>
                <th style={tableHeaderCellStyle}>Reason</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.rowNumber}-${row.raw.sku}`}>
                  <td style={tableCellStyle}>{row.rowNumber}</td>
                  <td style={tableCellStyle}>
                    {mode === "fba"
                      ? row.resolved?.warehouseLabel || "—"
                      : row.raw.warehouse_code || "—"}
                  </td>
                  <td style={tableCellStyle}>{row.raw.sku || "—"}</td>
                  <td style={tableCellStyle}>
                    {mode === "adjustment"
                      ? row.raw.qty_delta || "—"
                      : mode === "stocktake"
                        ? row.raw.counted_qty || "—"
                        : row.raw.amazon_fulfillable_qty || "—"}
                  </td>
                  <td style={tableCellStyle}>{row.raw.reason || defaultReasonMap[mode]}</td>
                  <td style={tableCellStyle}>{row.raw.reference || "—"}</td>
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
        <button type="button" onClick={handleCommit} style={primaryButtonStyle} disabled={!canCommit || isPosting}>
          {isPosting ? "Posting…" : validateOnly ? "Validate Import" : "Commit Import"}
        </button>
        {!canCommit && rows.length ? (
          <span style={{ color: "#b91c1c", fontWeight: 600 }}>Resolve all errors to continue.</span>
        ) : null}
      </div>

      {postSummary ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8, fontSize: 16 }}>Import Summary</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span style={successBadgeStyle}>OK: {postSummary.ok}</span>
            <span style={successBadgeStyle}>Posted: {postSummary.posted}</span>
            <span style={errorBadgeStyle}>Errors: {postSummary.errors}</span>
          </div>
        </div>
      ) : null}

      {showResultsTable ? (
        <section style={{ ...tableStyle, marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Row</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Message</th>
                {mode === "adjustment" ? null : (
                  <>
                    <th style={tableHeaderCellStyle}>Current Qty</th>
                    <th style={tableHeaderCellStyle}>Counted Qty</th>
                    <th style={tableHeaderCellStyle}>Delta</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {postResults.map((result) => (
                <tr key={`result-${result.row_index}`}>
                  <td style={tableCellStyle}>{result.row_index}</td>
                  <td style={tableCellStyle}>
                    {result.ok ? <span style={successBadgeStyle}>OK</span> : <span style={errorBadgeStyle}>Error</span>}
                  </td>
                  <td style={tableCellStyle}>{result.message || "—"}</td>
                  {mode === "adjustment" ? null : (
                    <>
                      <td style={tableCellStyle}>{result.current_qty ?? "—"}</td>
                      <td style={tableCellStyle}>{result.counted_qty ?? "—"}</td>
                      <td style={tableCellStyle}>{result.delta ?? "—"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
