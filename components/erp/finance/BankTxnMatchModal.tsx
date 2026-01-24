import { useEffect, useMemo, useState } from "react";
import {
  badgeStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../uiStyles";

export type BankTxnRow = {
  id: string;
  txn_date: string;
  description: string;
  reference_no: string | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  currency: string | null;
  is_matched: boolean;
};

type MatchParams = {
  fromDate: string;
  toDate: string;
  query: string;
  minAmount: string;
  maxAmount: string;
  unmatchedOnly: boolean;
  debitOnly: boolean;
};

type BankTxnMatchModalProps = {
  open: boolean;
  paymentDate: string;
  paymentAmount: number;
  currency?: string | null;
  loading: boolean;
  error: string | null;
  transactions: BankTxnRow[];
  onClose: () => void;
  onSearch: (params: MatchParams) => void;
  onMatch: (txn: BankTxnRow, notes: string) => void;
};

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
};

export default function BankTxnMatchModal({
  open,
  paymentDate,
  paymentAmount,
  currency,
  loading,
  error,
  transactions,
  onClose,
  onSearch,
  onMatch,
}: BankTxnMatchModalProps) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [unmatchedOnly, setUnmatchedOnly] = useState(true);
  const [debitOnly, setDebitOnly] = useState(true);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    const base = new Date(paymentDate);
    const from = new Date(base);
    const to = new Date(base);
    from.setDate(from.getDate() - 10);
    to.setDate(to.getDate() + 10);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(to.toISOString().slice(0, 10));
    setQuery("");
    setMinAmount("");
    setMaxAmount("");
    setNotes("");
    setUnmatchedOnly(true);
    setDebitOnly(true);
  }, [open, paymentDate]);

  useEffect(() => {
    if (!open || !fromDate || !toDate) return;
    onSearch({
      fromDate,
      toDate,
      query,
      minAmount,
      maxAmount,
      unmatchedOnly,
      debitOnly,
    });
  }, [open, fromDate, toDate, query, minAmount, maxAmount, unmatchedOnly, debitOnly, onSearch]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      if (unmatchedOnly && txn.is_matched) return false;
      if (debitOnly) {
        const debitValue = txn.debit ?? (txn.amount !== null ? Math.max(txn.amount, 0) : null);
        if (!debitValue || debitValue <= 0) return false;
      }
      return true;
    });
  }, [transactions, unmatchedOnly, debitOnly]);

  if (!open) return null;

  return (
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
      <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(920px, 96vw)" }}>
        <h3 style={{ marginTop: 0 }}>Match bank transaction</h3>
        <p style={{ color: "#64748b", marginTop: 6 }}>
          Match a bank transaction for {paymentDate} against{" "}
          <strong>
            {currency || "INR"} {formatCurrency(paymentAmount)}
          </strong>
          .
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Search</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Min amount</span>
            <input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Max amount</span>
            <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={unmatchedOnly}
              onChange={(e) => setUnmatchedOnly(e.target.checked)}
            />
            Unmatched only
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={debitOnly} onChange={(e) => setDebitOnly(e.target.checked)} />
            Debit only
          </label>
          <span style={{ ...badgeStyle, backgroundColor: "#ecfeff", color: "#0e7490" }}>
            {filteredTransactions.length} results
          </span>
        </div>
        <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
          <span>Match notes (optional)</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...inputStyle, minHeight: 70 }}
          />
        </label>
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <p>Loading transactions…</p>
          ) : error ? (
            <p style={{ color: "#b91c1c" }}>{error}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Date</th>
                    <th style={tableHeaderCellStyle}>Description</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Debit</th>
                    <th style={tableHeaderCellStyle}>Credit</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td style={tableCellStyle} colSpan={7}>
                        No transactions found.
                      </td>
                    </tr>
                  )}
                  {filteredTransactions.map((txn) => (
                    <tr key={txn.id}>
                      <td style={tableCellStyle}>{txn.txn_date}</td>
                      <td style={tableCellStyle}>{txn.description}</td>
                      <td style={tableCellStyle}>{txn.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.debit)}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.credit)}</td>
                      <td style={tableCellStyle}>{formatCurrency(txn.amount)}</td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => onMatch(txn, notes)}
                        >
                          Match
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
