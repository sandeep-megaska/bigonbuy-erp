import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type PurchaseInvoiceRow = {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  vendor_id: string;
  vendor_name: string;
  vendor_gstin: string | null;
  taxable_total: number;
  tax_total: number;
  itc_total: number;
  is_void: boolean;
  validation_status: "ok" | "warn" | "error";
};

type ValidationNotes = {
  errors?: Array<{ code?: string; message?: string }>;
  warnings?: Array<{ code?: string; message?: string }>;
} | null;

type PurchaseInvoiceDetail = {
  header: {
    id: string;
    invoice_no: string;
    invoice_date: string;
    vendor_id: string;
    vendor_name: string;
    vendor_gstin: string | null;
    vendor_state_code: string | null;
    place_of_supply_state_code: string | null;
    is_reverse_charge: boolean;
    is_import: boolean;
    currency: string;
    note: string | null;
    source: string;
    source_ref: string | null;
    is_void: boolean;
    validation_status: "ok" | "warn" | "error";
    validation_notes: ValidationNotes;
    computed_taxable: number;
    computed_total_tax: number;
    computed_invoice_total: number;
    created_at: string;
    updated_at: string;
  } | null;
  lines: Array<{
    id: string;
    line_no: number;
    description: string | null;
    hsn: string;
    qty: number | null;
    uom: string | null;
    taxable_value: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total_tax: number;
    line_total: number;
    itc_eligible: boolean;
    itc_reason: string | null;
    is_void: boolean;
  }>;
};

type ImportResult = {
  batch_id?: string;
  total_rows?: number;
  invoices_upserted?: number;
  lines_upserted?: number;
  error_count?: number;
  error_rows?: Array<{ row: number; reason: string }>;
  invoices_ok?: number;
  invoices_warn?: number;
  invoices_error?: number;
  error_invoices?: Array<{ invoice_no: string; vendor_name: string | null; reason: string }>;
};

type VendorOption = {
  id: string;
  legal_name: string;
  gstin: string | null;
};

type ParsedRow = {
  [key: string]: string | number | boolean | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value || 0);

const formatCsvValue = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

const buildCsvFromRows = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = rows.map((row) => headers.map((header) => formatCsvValue(row[header])).join(","));
  return [headers.join(","), ...lines].join("\n");
};

const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const headerAliases: Record<string, string> = {
  vendor_id: "vendor_id",
  supplier_id: "vendor_id",
  vendor_gstin: "vendor_gstin",
  gstin: "vendor_gstin",
  vendor_name: "vendor_name",
  supplier_name: "vendor_name",
  invoice_no: "invoice_no",
  invoice_number: "invoice_no",
  invoiceno: "invoice_no",
  invoice_date: "invoice_date",
  invoicedate: "invoice_date",
  place_of_supply_state_code: "place_of_supply_state_code",
  placeofsupplystatecode: "place_of_supply_state_code",
  is_reverse_charge: "is_reverse_charge",
  reverse_charge: "is_reverse_charge",
  is_import: "is_import",
  hsn: "hsn",
  description: "description",
  qty: "qty",
  quantity: "qty",
  uom: "uom",
  taxable_value: "taxable_value",
  taxablevalue: "taxable_value",
  cgst: "cgst",
  sgst: "sgst",
  igst: "igst",
  cess: "cess",
  itc_eligible: "itc_eligible",
  itc_reason: "itc_reason",
  line_no: "line_no",
  lineno: "line_no",
};

const parseNumber = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return ["true", "t", "yes", "y", "1"].includes(normalized);
};

const buildTemplateCsv = () => {
  const header = [
    "vendor_id",
    "vendor_gstin",
    "vendor_name",
    "invoice_no",
    "invoice_date",
    "place_of_supply_state_code",
    "is_reverse_charge",
    "is_import",
    "line_no",
    "hsn",
    "description",
    "qty",
    "uom",
    "taxable_value",
    "cgst",
    "sgst",
    "igst",
    "cess",
    "itc_eligible",
    "itc_reason",
  ].join(",");
  const sample = [
    "vendor-uuid",
    "29ABCDE1234F2Z5",
    "Vendor Pvt Ltd",
    "INV-001",
    "2024-04-01",
    "RJ",
    "false",
    "false",
    "1",
    "6105",
    "Cotton shirt",
    "10",
    "pcs",
    "1000",
    "25",
    "25",
    "0",
    "0",
    "true",
    "",
  ].join(",");
  return `${header}\n${sample}`;
};

export default function GstPurchasePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [validationFilter, setValidationFilter] = useState<string>("");
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [detail, setDetail] = useState<PurchaseInvoiceDetail | null>(null);
  const [csvRows, setCsvRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

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

      await Promise.all([loadVendors(), loadInvoices(fromDate, toDate, selectedVendor, validationFilter)]);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [fromDate, toDate, router, selectedVendor, validationFilter]);

  const loadVendors = async () => {
    const { data, error: vendorError } = await supabase
      .from("erp_vendors")
      .select("id, legal_name, gstin")
      .order("legal_name");

    if (vendorError) {
      setError(vendorError.message);
      return;
    }

    setVendors((data || []) as VendorOption[]);
  };

  const loadInvoices = async (start: string, end: string, vendorId: string, validationStatus: string) => {
    setIsLoadingInvoices(true);
    const { data, error: invoiceError } = await supabase.rpc("erp_gst_purchase_invoices_list", {
      p_from: start,
      p_to: end,
      p_vendor_id: vendorId || null,
      p_validation_status: validationStatus || null,
    });

    if (invoiceError) {
      setError(invoiceError.message);
      setIsLoadingInvoices(false);
      return;
    }

    setInvoices((data || []) as PurchaseInvoiceRow[]);
    setIsLoadingInvoices(false);
  };

  const handleCsvSelect = (file: File | null) => {
    setError(null);
    setImportResult(null);
    setCsvRows([]);
    setFileName(file?.name ?? null);

    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors?.length) {
          setError(results.errors[0]?.message || "Failed to parse CSV.");
          return;
        }

        const mappedRows = (results.data as Array<Record<string, unknown>>).map((row) => {
          const mapped: ParsedRow = {};
          Object.entries(row).forEach(([key, value]) => {
            const normalized = normalizeHeader(key);
            const mappedKey = headerAliases[normalized];
            if (!mappedKey) return;
            if (mappedKey === "qty" || mappedKey === "taxable_value") {
              mapped[mappedKey] = parseNumber(value);
              return;
            }
            if (["cgst", "sgst", "igst", "cess"].includes(mappedKey)) {
              mapped[mappedKey] = parseNumber(value) ?? 0;
              return;
            }
            if (mappedKey === "line_no") {
              const lineNo = parseNumber(value);
              mapped[mappedKey] = lineNo == null ? null : Math.trunc(lineNo);
              return;
            }
            if (["is_reverse_charge", "is_import", "itc_eligible"].includes(mappedKey)) {
              mapped[mappedKey] = parseBoolean(value);
              return;
            }
            mapped[mappedKey] = typeof value === "string" ? value.trim() : (value as string | null);
          });
          return mapped;
        });

        setCsvRows(mappedRows.filter((row) => Object.keys(row).length > 0));
      },
      error: (parseError) => {
        setError(parseError.message || "Failed to parse CSV.");
      },
    });
  };

  const handleImport = async () => {
    if (!csvRows.length) return;
    setIsImporting(true);
    setError(null);
    setImportResult(null);

    const { data, error: importError } = await supabase.rpc("erp_gst_purchase_import_csv", {
      p_rows: csvRows,
      p_filename: fileName,
    });

    if (importError) {
      setError(importError.message);
      setIsImporting(false);
      return;
    }

    setImportResult((data || {}) as ImportResult);
    await loadInvoices(fromDate, toDate, selectedVendor, validationFilter);
    setIsImporting(false);
  };

  const handleExport = async (rpcName: string, filename: string) => {
    setError(null);
    const { data, error: exportError } = await supabase.rpc(rpcName, {
      p_from: fromDate,
      p_to: toDate,
    });

    if (exportError) {
      setError(exportError.message);
      return;
    }

    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    if (!rows.length) {
      setError("No rows returned for export.");
      return;
    }

    const csv = buildCsvFromRows(rows);
    triggerDownload(filename, createCsvBlob(csv));
  };

  const handleShowDetail = async (invoiceId: string) => {
    setError(null);
    const { data, error: detailError } = await supabase.rpc("erp_gst_purchase_invoice_detail", {
      p_invoice_id: invoiceId,
    });

    if (detailError) {
      setError(detailError.message);
      return;
    }

    setDetail((data || null) as PurchaseInvoiceDetail);
  };

  const handleCloseDetail = () => setDetail(null);

  const handleRevalidate = async () => {
    if (!detail?.header) return;
    setError(null);
    setIsRevalidating(true);

    const { error: validateError } = await supabase.rpc("erp_gst_purchase_invoice_validate", {
      p_invoice_id: detail.header.id,
    });

    if (validateError) {
      setError(validateError.message);
      setIsRevalidating(false);
      return;
    }

    await Promise.all([
      handleShowDetail(detail.header.id),
      loadInvoices(fromDate, toDate, selectedVendor, validationFilter),
    ]);
    setIsRevalidating(false);
  };

  const handleDownloadTemplate = () => {
    triggerDownload("gst-purchase-template.csv", createCsvBlob(buildTemplateCsv()));
  };

  const getValidationLabel = (status?: string) => {
    switch (status) {
      case "error":
        return { label: "ERROR", color: "#b91c1c", background: "#fee2e2" };
      case "warn":
        return { label: "WARN", color: "#b45309", background: "#fef3c7" };
      default:
        return { label: "OK", color: "#047857", background: "#d1fae5" };
    }
  };

  const normalizeNotes = (notes?: ValidationNotes) => {
    if (!notes) {
      return { errors: [], warnings: [] };
    }
    return {
      errors: Array.isArray(notes.errors) ? notes.errors : [],
      warnings: Array.isArray(notes.warnings) ? notes.warnings : [],
    };
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading GST Purchase Engine…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="GST Purchases"
          description="Import vendor purchase invoices, review GST lines, and export register summaries."
          rightActions={
            <Link href="/erp/finance/gst" style={secondaryButtonStyle}>
              Back to GST
            </Link>
          }
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Date range</h2>
          <p style={subtitleStyle}>Filter invoices and exports by invoice date.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Vendor (optional)</span>
              <select
                value={selectedVendor}
                onChange={(event) => setSelectedVendor(event.target.value)}
                style={inputStyle}
              >
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Validation</span>
              <select
                value={validationFilter}
                onChange={(event) => setValidationFilter(event.target.value)}
                style={inputStyle}
              >
                <option value="">All statuses</option>
                <option value="ok">OK</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={handleDownloadTemplate}
            >
              Download CSV Template
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() =>
                handleExport("erp_gst_purchase_register_export", `gst-purchases-${fromDate}-to-${toDate}.csv`)
              }
            >
              Export Purchase Register
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() =>
                handleExport(
                  "erp_gst_purchase_hsn_summary_export",
                  `gst-purchases-hsn-${fromDate}-to-${toDate}.csv`
                )
              }
            >
              Export HSN Summary
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() =>
                handleExport(
                  "erp_gst_purchase_itc_summary_export",
                  `gst-purchases-itc-${fromDate}-to-${toDate}.csv`
                )
              }
            >
              Export ITC Summary
            </button>
          </div>
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>CSV Import</h2>
          <p style={subtitleStyle}>
            Upload purchase invoice lines (one row per HSN line). Use vendor_id for best matching.
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={(event) => handleCsvSelect(event.target.files?.[0] || null)}
          />
          {csvRows.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <strong>{csvRows.length}</strong> rows ready to import.
              </div>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleImport}
                disabled={!canWrite || isImporting}
              >
                {isImporting ? "Importing…" : "Import CSV"}
              </button>
              {!canWrite && (
                <p style={{ color: "#b91c1c", marginTop: 8 }}>
                  You do not have finance write access.
                </p>
              )}
            </div>
          )}
          {csvRows.length > 0 && (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Row</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Invoice No</th>
                    <th style={tableHeaderCellStyle}>Invoice Date</th>
                    <th style={tableHeaderCellStyle}>HSN</th>
                    <th style={tableHeaderCellStyle}>Taxable Value</th>
                    <th style={tableHeaderCellStyle}>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 20).map((row, index) => (
                    <tr key={index}>
                      <td style={tableCellStyle}>{index + 1}</td>
                      <td style={tableCellStyle}>
                        {String(row.vendor_name || row.vendor_id || row.vendor_gstin || "—")}
                      </td>
                      <td style={tableCellStyle}>{String(row.invoice_no || "—")}</td>
                      <td style={tableCellStyle}>{String(row.invoice_date || "—")}</td>
                      <td style={tableCellStyle}>{String(row.hsn || "—")}</td>
                      <td style={tableCellStyle}>
                        {row.taxable_value == null ? "—" : formatMoney(Number(row.taxable_value))}
                      </td>
                      <td style={tableCellStyle}>
                        {formatMoney(
                          Number(row.cgst || 0) +
                            Number(row.sgst || 0) +
                            Number(row.igst || 0) +
                            Number(row.cess || 0)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 20 && (
                <p style={{ marginTop: 8, color: "#64748b" }}>Showing first 20 rows.</p>
              )}
            </div>
          )}
          {importResult && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Import results</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Total rows: {importResult.total_rows ?? 0}</li>
                <li>Invoices upserted: {importResult.invoices_upserted ?? 0}</li>
                <li>Lines upserted: {importResult.lines_upserted ?? 0}</li>
                <li>Errors: {importResult.error_count ?? 0}</li>
                <li>Validated OK: {importResult.invoices_ok ?? 0}</li>
                <li>Validated Warnings: {importResult.invoices_warn ?? 0}</li>
                <li>Validated Errors: {importResult.invoices_error ?? 0}</li>
              </ul>
              {importResult.error_rows && importResult.error_rows.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong>First errors</strong>
                  <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                    {importResult.error_rows.map((row, idx) => (
                      <li key={idx}>
                        Row {row.row}: {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.error_invoices && importResult.error_invoices.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <strong>Validation errors</strong>
                  <div style={{ marginTop: 8, overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={tableHeaderCellStyle}>Invoice No</th>
                          <th style={tableHeaderCellStyle}>Vendor</th>
                          <th style={tableHeaderCellStyle}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.error_invoices.map((row, idx) => (
                          <tr key={`${row.invoice_no}-${idx}`}>
                            <td style={tableCellStyle}>{row.invoice_no}</td>
                            <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                            <td style={tableCellStyle}>{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0 }}>Invoices</h2>
          <p style={subtitleStyle}>Click an invoice to view line details.</p>
          {isLoadingInvoices ? (
            <p>Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p>No invoices found for this period.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Date</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Invoice No</th>
                    <th style={tableHeaderCellStyle}>Taxable Total</th>
                    <th style={tableHeaderCellStyle}>Tax Total</th>
                    <th style={tableHeaderCellStyle}>ITC Total</th>
                    <th style={tableHeaderCellStyle}>Validation</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const badge = getValidationLabel(invoice.validation_status);
                    return (
                      <tr
                        key={invoice.invoice_id}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleShowDetail(invoice.invoice_id)}
                      >
                        <td style={tableCellStyle}>{invoice.invoice_date}</td>
                        <td style={tableCellStyle}>{invoice.vendor_name}</td>
                        <td style={tableCellStyle}>{invoice.invoice_no}</td>
                        <td style={tableCellStyle}>{formatMoney(invoice.taxable_total || 0)}</td>
                        <td style={tableCellStyle}>{formatMoney(invoice.tax_total || 0)}</td>
                        <td style={tableCellStyle}>{formatMoney(invoice.itc_total || 0)}</td>
                        <td style={tableCellStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 600,
                              color: badge.color,
                              background: badge.background,
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td style={tableCellStyle}>{invoice.is_void ? "Void" : "Active"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {detail?.header && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              zIndex: 50,
            }}
          >
            <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(920px, 90vw)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Invoice {detail.header.invoice_no}</h3>
                  <p style={{ margin: "4px 0", color: "#64748b" }}>
                    {detail.header.vendor_name} · {detail.header.invoice_date}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={handleRevalidate}
                    disabled={!canWrite || isRevalidating}
                  >
                    {isRevalidating ? "Revalidating…" : "Revalidate"}
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={handleCloseDetail}>
                    Close
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div>GSTIN: {detail.header.vendor_gstin || "—"}</div>
                <div>POS: {detail.header.place_of_supply_state_code || "—"}</div>
                <div>Reverse charge: {detail.header.is_reverse_charge ? "Yes" : "No"}</div>
                <div>Import: {detail.header.is_import ? "Yes" : "No"}</div>
              </div>
              <div style={{ marginTop: 12 }}>
                {(() => {
                  const badge = getValidationLabel(detail.header.validation_status);
                  const { errors, warnings } = normalizeNotes(detail.header.validation_notes);
                  return (
                    <div
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        padding: 12,
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <strong>Validation</strong>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 600,
                              color: badge.color,
                              background: badge.background,
                            }}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <div style={{ color: "#475569" }}>
                          Computed total: {formatMoney(detail.header.computed_invoice_total || 0)}
                        </div>
                      </div>
                      {errors.length === 0 && warnings.length === 0 ? (
                        <p style={{ marginTop: 8, marginBottom: 0, color: "#475569" }}>
                          No validation issues detected.
                        </p>
                      ) : (
                        <div style={{ marginTop: 8 }}>
                          {errors.length > 0 && (
                            <div style={{ marginBottom: warnings.length ? 8 : 0 }}>
                              <strong style={{ color: "#b91c1c" }}>Errors</strong>
                              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                                {errors.map((item, idx) => (
                                  <li key={`error-${idx}`}>{item.message || item.code || "Validation error"}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {warnings.length > 0 && (
                            <div>
                              <strong style={{ color: "#b45309" }}>Warnings</strong>
                              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                                {warnings.map((item, idx) => (
                                  <li key={`warn-${idx}`}>{item.message || item.code || "Validation warning"}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div style={{ marginTop: 16, maxHeight: "50vh", overflowY: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Line</th>
                      <th style={tableHeaderCellStyle}>HSN</th>
                      <th style={tableHeaderCellStyle}>Description</th>
                      <th style={tableHeaderCellStyle}>Qty</th>
                      <th style={tableHeaderCellStyle}>Taxable</th>
                      <th style={tableHeaderCellStyle}>CGST</th>
                      <th style={tableHeaderCellStyle}>SGST</th>
                      <th style={tableHeaderCellStyle}>IGST</th>
                      <th style={tableHeaderCellStyle}>Cess</th>
                      <th style={tableHeaderCellStyle}>ITC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id}>
                        <td style={tableCellStyle}>{line.line_no}</td>
                        <td style={tableCellStyle}>{line.hsn}</td>
                        <td style={tableCellStyle}>{line.description || "—"}</td>
                        <td style={tableCellStyle}>{line.qty ?? "—"}</td>
                        <td style={tableCellStyle}>{formatMoney(line.taxable_value)}</td>
                        <td style={tableCellStyle}>{formatMoney(line.cgst)}</td>
                        <td style={tableCellStyle}>{formatMoney(line.sgst)}</td>
                        <td style={tableCellStyle}>{formatMoney(line.igst)}</td>
                        <td style={tableCellStyle}>{formatMoney(line.cess)}</td>
                        <td style={tableCellStyle}>{line.itc_eligible ? "Eligible" : "Ineligible"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 16, color: "#b91c1c" }}>
            {error}
          </div>
        )}
      </div>
    </ErpShell>
  );
}
