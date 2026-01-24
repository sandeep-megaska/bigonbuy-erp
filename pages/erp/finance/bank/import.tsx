import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import * as XLSX from "xlsx";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type BankImportRow = {
  txn_date: string;
  value_date?: string | null;
  description: string;
  reference_no?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
  balance?: string | number | null;
  currency?: string | null;
  raw: Record<string, unknown>;
};

type ImportErrorRow = {
  row: BankImportRow;
  error: string;
};

type ImportResult = {
  inserted: number;
  skipped: number;
  errors: number;
  error_rows: ImportErrorRow[];
};

type BankTxnRow = {
  id: string;
  source: string;
  account_ref: string | null;
  txn_date: string;
  value_date: string | null;
  description: string;
  reference_no: string | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  balance: number | null;
  currency: string | null;
  is_matched: boolean;
  is_void: boolean;
  void_reason: string | null;
  created_at: string;
};

const headerAliases = {
  txnDate: ["transaction date", "txn date", "transactiondate", "date", "transaction_date"],
  valueDate: ["value date", "valuedate", "value_date", "value"],
  description: [
    "transaction remarks",
    "remarks",
    "transactionremarks",
    "narration",
    "description",
    "particulars",
  ],
  reference: [
    "cheque number",
    "cheque no",
    "chequeno",
    "cheque",
    "reference",
    "reference no",
    "ref no",
    "refno",
    "transaction id",
    "transactionid",
    "utr",
    "rrn",
  ],
  debit: ["withdrawal amt.", "withdrawal amt", "withdrawal", "debit", "dr amount", "dr amt"],
  credit: ["deposit amt.", "deposit amt", "deposit", "credit", "cr amount", "cr amt"],
  balance: ["balance", "closing balance", "balance amt", "balance amount"],
  currency: ["currency", "curr"],
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const index = normalized.indexOf(aliasKey);
    if (index >= 0) return headers[index];
  }
  return null;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function parseIciciXls(file: File): Promise<Record<string, any>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const [sheetName] = workbook.SheetNames;
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateInput(value);
  return String(value).trim();
}

function normalizeAmount(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, "");
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric)) return numeric;
  return text;
}

function normalizeIciciRows(rows: Record<string, any>[]) {
  const headerSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => headerSet.add(key));
  });
  const headers = Array.from(headerSet);
  const txnDateHeader = findHeader(headers, headerAliases.txnDate);
  const valueDateHeader = findHeader(headers, headerAliases.valueDate);
  const descriptionHeader = findHeader(headers, headerAliases.description);
  const referenceHeader = findHeader(headers, headerAliases.reference);
  const debitHeader = findHeader(headers, headerAliases.debit);
  const creditHeader = findHeader(headers, headerAliases.credit);
  const balanceHeader = findHeader(headers, headerAliases.balance);
  const currencyHeader = findHeader(headers, headerAliases.currency);

  return rows
    .map((row) => {
      const txnDate = txnDateHeader ? normalizeText(row[txnDateHeader]) : "";
      const valueDate = valueDateHeader ? normalizeText(row[valueDateHeader]) : "";
      const description = descriptionHeader ? normalizeText(row[descriptionHeader]) : "";
      const reference = referenceHeader ? normalizeText(row[referenceHeader]) : "";
      const debit = debitHeader ? normalizeAmount(row[debitHeader]) : null;
      const credit = creditHeader ? normalizeAmount(row[creditHeader]) : null;
      const balance = balanceHeader ? normalizeAmount(row[balanceHeader]) : null;
      const currency = currencyHeader ? normalizeText(row[currencyHeader]) : "";

      return {
        txn_date: txnDate || valueDate || "",
        value_date: valueDate || null,
        description: description || "",
        reference_no: reference || null,
        debit: debit || null,
        credit: credit || null,
        balance: balance || null,
        currency: currency || null,
        raw: row,
      } satisfies BankImportRow;
    })
    .filter((row) =>
      [row.txn_date, row.value_date, row.description, row.reference_no, row.debit, row.credit].some(
        (value) => value && String(value).trim() !== ""
      )
    );
}

export default function BankImportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<BankImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountRef, setAccountRef] = useState("");

  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return formatDateInput(date);
  });
  const [toDate, setToDate] = useState(() => formatDateInput(new Date()));
  const [transactions, setTransactions] = useState<BankTxnRow[]>([]);
  const [isLoadingTxns, setIsLoadingTxns] = useState(false);

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

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadTransactions = async () => {
    if (!ctx?.companyId) return;
    setIsLoadingTxns(true);
    setError(null);

    const { data, error: listError } = await supabase.rpc("erp_bank_txns_list", {
      p_from: fromDate,
      p_to: toDate,
      p_source: "icici",
    });

    if (listError) {
      setError(listError.message);
      setIsLoadingTxns(false);
      return;
    }

    setTransactions((data as BankTxnRow[]) || []);
    setIsLoadingTxns(false);
  };

  useEffect(() => {
    if (!loading && ctx?.companyId) {
      void loadTransactions();
    }
  }, [loading, ctx?.companyId, fromDate, toDate]);

  const handleFile = async (file: File) => {
    setParseError(null);
    setImportResult(null);
    setRows([]);
    setFileName(file.name);

    try {
      const parsedRows = normalizeIciciRows(await parseIciciXls(file));
      if (!parsedRows.length) {
        setParseError("No valid rows found in XLS.");
        return;
      }
      setRows(parsedRows);
    } catch (parseErr) {
      setParseError(
        parseErr instanceof Error ? parseErr.message : "Failed to parse XLS statement."
      );
    }
  };

  const handleImport = async () => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can import bank transactions.");
      return;
    }
    if (!rows.length) {
      setError("Upload an XLS statement before importing.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setImportResult(null);

    const { data, error: importError } = await supabase.rpc("erp_bank_txn_import_icici_csv", {
      p_rows: rows,
      p_source: "icici",
      p_account_ref: accountRef.trim() || null,
    });

    if (importError) {
      setError(importError.message);
      setIsSubmitting(false);
      return;
    }

    setImportResult(data as ImportResult);
    setIsSubmitting(false);
    await loadTransactions();
  };

  if (loading) {
    return (
      <ErpShell>
        <div style={pageContainerStyle}>Loading...</div>
      </ErpShell>
    );
  }

  if (error) {
    return (
      <ErpShell>
        <div style={pageContainerStyle}>
          <ErpPageHeader title="Bank XLS Import" />
          <div style={cardStyle}>{error}</div>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          title="Bank XLS Import"
          description="Upload ICICI corporate statement XLS files, review, and ingest transactions."
        />

        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleFile(file);
                }
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 220 }}>
              <label htmlFor="account_ref">Account reference (optional)</label>
              <input
                id="account_ref"
                style={inputStyle}
                value={accountRef}
                onChange={(event) => setAccountRef(event.target.value)}
                placeholder="ICICI-OD-001"
              />
            </div>
          </div>
          {fileName && <p style={{ marginTop: 0 }}>Selected file: {fileName}</p>}
          {parseError && <p style={{ color: "#b91c1c" }}>{parseError}</p>}
          <button style={primaryButtonStyle} onClick={handleImport} disabled={isSubmitting}>
            {isSubmitting ? "Importing..." : "Import ICICI XLS"}
          </button>
        </div>

        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3>Preview (first 20 rows)</h3>
          {rows.length === 0 ? (
            <p>No rows parsed yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Txn date</th>
                    <th style={tableHeaderCellStyle}>Value date</th>
                    <th style={tableHeaderCellStyle}>Description</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Debit</th>
                    <th style={tableHeaderCellStyle}>Credit</th>
                    <th style={tableHeaderCellStyle}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, index) => (
                    <tr key={`${row.txn_date}-${row.reference_no || index}`}>
                      <td style={tableCellStyle}>{row.txn_date}</td>
                      <td style={tableCellStyle}>{row.value_date || ""}</td>
                      <td style={tableCellStyle}>{row.description}</td>
                      <td style={tableCellStyle}>{row.reference_no || ""}</td>
                      <td style={tableCellStyle}>{row.debit || ""}</td>
                      <td style={tableCellStyle}>{row.credit || ""}</td>
                      <td style={tableCellStyle}>{row.balance || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {importResult && (
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <h3>Import results</h3>
            <p>
              Inserted: <strong>{importResult.inserted}</strong> | Skipped: {importResult.skipped} |
              Errors: {importResult.errors}
            </p>
            {importResult.error_rows?.length ? (
              <div>
                <h4>Sample errors (first 10)</h4>
                <ul>
                  {importResult.error_rows.slice(0, 10).map((row, index) => (
                    <li key={`${row.error}-${index}`}>
                      {row.error} (Txn date: {row.row.txn_date || "n/a"})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3>Imported transactions</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label htmlFor="from_date">From</label>
              <input
                id="from_date"
                type="date"
                style={inputStyle}
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="to_date">To</label>
              <input
                id="to_date"
                type="date"
                style={inputStyle}
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
            <button style={secondaryButtonStyle} onClick={loadTransactions} disabled={isLoadingTxns}>
              {isLoadingTxns ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {transactions.length === 0 ? (
            <p style={{ marginTop: 16 }}>No transactions found in this date range.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Txn date</th>
                    <th style={tableHeaderCellStyle}>Description</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Debit</th>
                    <th style={tableHeaderCellStyle}>Credit</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Balance</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr key={txn.id}>
                      <td style={tableCellStyle}>{txn.txn_date}</td>
                      <td style={tableCellStyle}>{txn.description}</td>
                      <td style={tableCellStyle}>{txn.reference_no || ""}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.debit)}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.credit)}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.amount)}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.balance)}</td>
                      <td style={tableCellStyle}>{txn.is_void ? "Voided" : "Active"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ErpShell>
  );
}
