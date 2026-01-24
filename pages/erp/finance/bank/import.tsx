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
  matched_entity_type: string | null;
  matched_entity_id: string | null;
  match_confidence: string | null;
  match_notes: string | null;
  created_at: string;
};

type IciciDebugRow = {
  keys: string[];
  crdr: string;
  amount: number | null;
  balance: number | null;
  reference: string | null;
};

const headerAliases = {
  txn_date: ["transactiondate", "txndate", "txn.date", "transaction date"],
  value_date: ["valuedate", "value date"],
  description: [
    "transactionremarks",
    "remarks",
    "narration",
    "description",
    "transaction particulars",
    "transactionparticulars",
  ],
  debit: ["withdrawalamt", "withdrawalamount", "withdrawal", "debit", "debitamt", "debitamount", "dramount", "dr"],
  credit: ["depositamt", "depositamount", "deposit", "credit", "creditamt", "creditamount", "cramount", "cr"],
  balance: ["balance", "closingbalance", "availablebalance", "balanceinr", "balance(inr)", "balancein"],
  crdr: ["crdr", "cr/dr"],
  transaction_amount: ["transactionamountinr", "transactionamount", "transaction amount(inr)"],
  available_balance: ["availablebalanceinr", "available balance(inr)", "balance"],
  reference_no: [
    "transactionid",
    "transactionref",
    "referenceno",
    "reference",
    "chqno",
    "chequenumber",
    "chequenumber",
    "utr",
    "rrn",
  ],
};

const headerDetectionTokens = [
  "transactiondate",
  "txndate",
  "valuedate",
  "narration",
  "remarks",
  "description",
  "withdrawal",
  "debit",
  "deposit",
  "credit",
  "balance",
  "crdr",
  "transactionamountinr",
  "availablebalanceinr",
];

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

function getByAliases(row: Record<string, unknown>, aliases: string[]) {
  const normalizedRow = Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalizedKey = normalizeHeader(key);
    if (!(normalizedKey in acc)) {
      acc[normalizedKey] = value;
    }
    return acc;
  }, {});

  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const value = normalizedRow[aliasKey];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function getByAliasesLoose(row: Record<string, unknown>, aliases: string[]) {
  const normalizedRow = Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalizedKey = normalizeHeader(key);
    if (!(normalizedKey in acc)) {
      acc[normalizedKey] = value;
    }
    return acc;
  }, {});

  const isPresent = (value: unknown) =>
    value !== null && value !== undefined && String(value).trim() !== "";

  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const value = normalizedRow[aliasKey];
    if (isPresent(value)) {
      return value;
    }
  }

  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    for (const [key, value] of Object.entries(normalizedRow)) {
      if ((key.includes(aliasKey) || aliasKey.includes(key)) && isPresent(value)) {
        return value;
      }
    }
  }

  return "";
}

function toNum(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || text === "-") return null;
  const normalized = text.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function parseIciciXls(file: File): Promise<any[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const [sheetName] = workbook.SheetNames;
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateInput(value);
  return String(value).trim();
}

function extractReferenceNo(description: string) {
  if (!description) return null;
  const prefixMatch = description.match(/(?:NEFT|IMPS|UPI|RTGS|UTR)[^A-Za-z0-9]*([A-Za-z0-9]+)/i);
  if (prefixMatch?.[1]) {
    return prefixMatch[1];
  }
  const utrMatch = description.match(/[A-Za-z0-9]{10,}/);
  return utrMatch ? utrMatch[0] : null;
}

function detectHeaderRow(matrix: any[][]) {
  const tokens = headerDetectionTokens.map(normalizeHeader);
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const normalizedRow = row.map((cell) => normalizeHeader(String(cell ?? "")));
    const matchCount = tokens.reduce((count, token) => {
      return normalizedRow.some((cell) => cell.includes(token)) ? count + 1 : count;
    }, 0);
    if (matchCount >= 2) {
      return rowIndex;
    }
  }
  return -1;
}

function normalizeIciciRows(matrix: any[][]) {
  const headerIndex = detectHeaderRow(matrix);
  if (headerIndex === -1) {
    return { rows: [], detectedHeaders: [] as string[], debugRows: [] as IciciDebugRow[] };
  }

  const headerRow = (matrix[headerIndex] || []).map((cell) => normalizeText(cell));
  const detectedHeaders = headerRow.filter((header) => header);
  const dataRows = matrix.slice(headerIndex + 1);
  const debugRows: IciciDebugRow[] = [];

  const normalizedRows = dataRows
    .map((row): BankImportRow | null => {
      const rowObj = row.reduce<Record<string, unknown>>((acc, cell, index) => {
        const header = headerRow[index];
        if (header) {
          acc[header] = cell;
        }
        return acc;
      }, {});

      const hasValues = Object.values(rowObj).some(
        (value) => value !== null && value !== undefined && String(value).trim() !== ""
      );
      if (!hasValues) {
        return null;
      }

      const txnDate = normalizeText(getByAliases(rowObj, headerAliases.txn_date));
      const valueDate = normalizeText(getByAliases(rowObj, headerAliases.value_date));
      const description = normalizeText(getByAliases(rowObj, headerAliases.description));
      const desc = description || "";
      const transactionId = normalizeText(
        getByAliasesLoose(rowObj, ["transaction id", "transactionid"])
      );
      const chequeNo = normalizeText(
        getByAliasesLoose(rowObj, ["chequeno", "cheque no", "chqno", "cheque number"])
      );
      const reference =
        transactionId || (chequeNo && chequeNo !== "-" ? chequeNo : "") || extractReferenceNo(desc);

      const amount =
        toNum(
          getByAliasesLoose(rowObj, [
            "transaction amount(inr)",
            "transaction amount",
            ...headerAliases.transaction_amount,
          ])
        ) ?? 0;
      const crdr = normalizeText(
        getByAliasesLoose(rowObj, ["cr/dr", "crdr", ...headerAliases.crdr])
      ).toUpperCase();

      let debit = 0;
      let credit = 0;

      if (crdr === "CR") credit = amount;
      if (crdr === "DR") debit = amount;

      const balance = toNum(
        getByAliasesLoose(rowObj, [
          "available balance(inr)",
          "availablebalanceinr",
          ...headerAliases.available_balance,
        ])
      );

      const fallbackTxnDate = normalizeText(getByAliases(rowObj, ["valuedate"]));
      const fallbackValueDate = normalizeText(getByAliases(rowObj, ["valuedate"]));

      const mappedRow: BankImportRow = {
        txn_date: txnDate || fallbackTxnDate || "",
        value_date: valueDate || fallbackValueDate || null,
        description: desc,
        reference_no: reference || null,
        debit,
        credit,
        balance,
        currency: "INR",
        raw: rowObj,
      };

      if (debugRows.length < 5) {
        debugRows.push({
          keys: Object.keys(rowObj).slice(0, 20),
          crdr,
          amount,
          balance,
          reference: reference || null,
        });
      }

      return mappedRow;
    })
    .filter((row): row is BankImportRow => row !== null);

  return {
    rows: normalizedRows.filter((row) =>
      [row.txn_date, row.value_date, row.description, row.reference_no, row.debit, row.credit].some(
        (value) => value && String(value).trim() !== ""
      )
    ),
    detectedHeaders,
    debugRows,
  };
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
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [debugRows, setDebugRows] = useState<IciciDebugRow[]>([]);

  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return formatDateInput(date);
  });
  const [toDate, setToDate] = useState(() => formatDateInput(new Date()));
  const [query, setQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [transactions, setTransactions] = useState<BankTxnRow[]>([]);
  const [isLoadingTxns, setIsLoadingTxns] = useState(false);
  const [matchModal, setMatchModal] = useState<{ open: boolean; txn?: BankTxnRow }>({ open: false });
  const [unmatchModal, setUnmatchModal] = useState<{ open: boolean; txn?: BankTxnRow }>({ open: false });
  const [matchVendorPaymentId, setMatchVendorPaymentId] = useState("");
  const [matchNotes, setMatchNotes] = useState("");
  const [unmatchReason, setUnmatchReason] = useState("");
  const [isMatching, setIsMatching] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);

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
    const trimmedQuery = query.trim();

    const { data, error: listError } = await supabase.rpc("erp_bank_txns_search", {
      p_from: fromDate,
      p_to: toDate,
      p_source: null,
      p_query: trimmedQuery || null,
      p_min_amount: toNum(minAmount) ?? null,
      p_max_amount: toNum(maxAmount) ?? null,
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
  }, [loading, ctx?.companyId]);

  const handleFile = async (file: File) => {
    setParseError(null);
    setImportResult(null);
    setRows([]);
    setFileName(file.name);
    setDetectedHeaders([]);
    setDebugRows([]);

    try {
      const { rows: parsedRows, detectedHeaders: headers, debugRows: debug } = normalizeIciciRows(
        await parseIciciXls(file)
      );
      setDetectedHeaders(headers);
      setDebugRows(debug);
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

  const openMatchModal = (txn: BankTxnRow) => {
    setMatchModal({ open: true, txn });
    setMatchVendorPaymentId("");
    setMatchNotes("");
  };

  const openUnmatchModal = (txn: BankTxnRow) => {
    setUnmatchModal({ open: true, txn });
    setUnmatchReason("");
  };

  const closeMatchModal = () => setMatchModal({ open: false });
  const closeUnmatchModal = () => setUnmatchModal({ open: false });

  const handleMatch = async () => {
    if (!matchModal.txn) return;
    const vendorPaymentId = matchVendorPaymentId.trim();
    if (!vendorPaymentId) {
      setError("Vendor payment ID is required.");
      return;
    }
    setError(null);
    setIsMatching(true);
    const { error: matchError } = await supabase.rpc("erp_bank_match_vendor_payment", {
      p_bank_txn_id: matchModal.txn.id,
      p_vendor_payment_id: vendorPaymentId,
      p_confidence: "manual",
      p_notes: matchNotes.trim() || null,
    });

    if (matchError) {
      setError(matchError.message);
      setIsMatching(false);
      return;
    }

    setIsMatching(false);
    closeMatchModal();
    await loadTransactions();
  };

  const handleUnmatch = async () => {
    if (!unmatchModal.txn) return;
    const reason = unmatchReason.trim();
    if (!reason) {
      setError("Unmatch reason is required.");
      return;
    }
    setError(null);
    setIsUnmatching(true);
    const { error: unmatchError } = await supabase.rpc("erp_bank_unmatch", {
      p_bank_txn_id: unmatchModal.txn.id,
      p_reason: reason,
    });

    if (unmatchError) {
      setError(unmatchError.message);
      setIsUnmatching(false);
      return;
    }

    setIsUnmatching(false);
    closeUnmatchModal();
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
          {detectedHeaders.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <strong>Detected headers (first 20):</strong>
              <div>{detectedHeaders.slice(0, 20).join(", ")}</div>
            </div>
          )}
          {debugRows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <strong>Debug (first 5 rows):</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {debugRows.map((row, index) => (
                  <div key={`debug-row-${index}`} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <div>
                      <strong>Keys:</strong> {row.keys.join(", ")}
                    </div>
                    <div>
                      <strong>Computed:</strong> crdr={row.crdr || "n/a"}, amount=
                      {row.amount ?? "n/a"}, balance={row.balance ?? "n/a"}, reference=
                      {row.reference ?? "n/a"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            <div style={{ minWidth: 260 }}>
              <label htmlFor="search_query">Search</label>
              <input
                id="search_query"
                style={inputStyle}
                value={query}
                placeholder="Search party / narration / reference"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void loadTransactions();
                  }
                }}
              />
            </div>
            <div>
              <label htmlFor="min_amount">Min amount</label>
              <input
                id="min_amount"
                type="number"
                style={inputStyle}
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="max_amount">Max amount</label>
              <input
                id="max_amount"
                type="number"
                style={inputStyle}
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
              />
            </div>
            <button style={secondaryButtonStyle} onClick={loadTransactions} disabled={isLoadingTxns}>
              {isLoadingTxns ? "Applying..." : "Apply"}
            </button>
          </div>
          <p style={{ marginTop: 12 }}>
            Showing {transactions.length} transactions from {fromDate} to {toDate} (query: "
            {query.trim() || "All"}")
          </p>

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
                    <th style={tableHeaderCellStyle}>Actions</th>
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
                      <td style={tableCellStyle}>{txn.is_matched ? "Matched" : "Unmatched"}</td>
                      <td style={tableCellStyle}>
                        {txn.is_matched ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>Matched</span>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => openUnmatchModal(txn)}
                              disabled={!canWrite || isUnmatching}
                            >
                              Unmatch
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => openMatchModal(txn)}
                            disabled={!canWrite || isMatching}
                          >
                            Match
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {matchModal.open && matchModal.txn && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(520px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Match bank transaction</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>
              Match the bank transaction on {matchModal.txn.txn_date} for{" "}
              <strong>₹ {formatCurrency(matchModal.txn.amount)}</strong> to a vendor payment.
            </p>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Vendor payment ID</span>
                <input
                  value={matchVendorPaymentId}
                  onChange={(event) => setMatchVendorPaymentId(event.target.value)}
                  style={inputStyle}
                  placeholder="UUID of vendor payment"
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Notes (optional)</span>
                <textarea
                  rows={3}
                  value={matchNotes}
                  onChange={(event) => setMatchNotes(event.target.value)}
                  style={{ ...inputStyle, minHeight: 80 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={closeMatchModal}
                disabled={isMatching}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleMatch}
                disabled={!matchVendorPaymentId.trim() || isMatching}
              >
                {isMatching ? "Matching…" : "Confirm match"}
              </button>
            </div>
          </div>
        </div>
      )}

      {unmatchModal.open && unmatchModal.txn && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(520px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Unmatch bank transaction</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>
              Provide a reason to unmatch the transaction on {unmatchModal.txn.txn_date} for{" "}
              <strong>₹ {formatCurrency(unmatchModal.txn.amount)}</strong>.
            </p>
            <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
              <span>Reason</span>
              <textarea
                rows={3}
                value={unmatchReason}
                onChange={(event) => setUnmatchReason(event.target.value)}
                style={{ ...inputStyle, minHeight: 80 }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={closeUnmatchModal}
                disabled={isUnmatching}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleUnmatch}
                disabled={!unmatchReason.trim() || isUnmatching}
              >
                {isUnmatching ? "Unmatching…" : "Confirm unmatch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErpShell>
  );
}
