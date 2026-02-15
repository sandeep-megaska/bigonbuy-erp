import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Papa from "papaparse";
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
import { createCsvBlob, triggerDownload } from "../../../../components/inventory/csvUtils";
import {
  expenseImportResponseSchema,
  expenseImportRowSchema,
  type ExpenseImportResponse,
  type ExpenseImportRow,
} from "../../../../lib/erp/expenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type ParsedRow = {
  rowIndex: number;
  raw: ExpenseImportRow;
  errors: string[];
};

const requiredHeaders = [
  "expense_date",
  "amount",
  "currency",
  "category_code",
  "channel_code",
  "warehouse_code",
  "vendor_name",
  "payee_name",
  "reference",
  "description",
  "attachment_url",
];

const buildDuplicateKey = (row: ExpenseImportRow) => {
  const keyParts = [
    row.expense_date || "",
    row.amount || "",
    row.category_code || "",
    row.reference || row.payee_name || row.vendor_name || "",
  ];
  return keyParts.map((part) => part.trim().toUpperCase()).join("|");
};

export default function ExpenseImportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validateOnly, setValidateOnly] = useState(true);
  const [importResult, setImportResult] = useState<ExpenseImportResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleTemplateDownload = () => {
    const csv = [requiredHeaders.join(",")].join("\n");
    triggerDownload("expense_import_template.csv", createCsvBlob(csv));
  };

  const handleFile = (file: File) => {
    setParseError(null);
    setImportResult(null);
    setRows([]);
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data.map((row, index) => {
          const normalized: ExpenseImportRow = {
            expense_date: row.expense_date?.trim() || "",
            amount: row.amount?.trim() || "",
            currency: row.currency?.trim() || "",
            category_code: row.category_code?.trim() || "",
            channel_code: row.channel_code?.trim() || "",
            warehouse_code: row.warehouse_code?.trim() || "",
            vendor_name: row.vendor_name?.trim() || "",
            payee_name: row.payee_name?.trim() || "",
            reference: row.reference?.trim() || "",
            description: row.description?.trim() || "",
            attachment_url: row.attachment_url?.trim() || "",
          };

          const result = expenseImportRowSchema.safeParse(normalized);
          const errors: string[] = [];
          if (!result.success) {
            errors.push("Invalid CSV row structure.");
          }
          if (!normalized.expense_date) errors.push("Missing expense_date.");
          if (!normalized.amount) errors.push("Missing amount.");
          if (!normalized.category_code) errors.push("Missing category_code.");
          return {
            rowIndex: index + 1,
            raw: normalized,
            errors,
          };
        });

        const duplicates = new Map<string, number>();
        parsed.forEach((row) => {
          const key = buildDuplicateKey(row.raw);
          duplicates.set(key, (duplicates.get(key) || 0) + 1);
        });

        const withDupes = parsed.map((row) => {
          const key = buildDuplicateKey(row.raw);
          if ((duplicates.get(key) || 0) > 1) {
            return { ...row, errors: [...row.errors, "Duplicate row in upload."] };
          }
          return row;
        });

        setRows(withDupes);
      },
      error: (parseErr) => {
        setParseError(parseErr.message || "Failed to parse CSV.");
      },
    });
  };

  const handleSubmit = async () => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can import expenses.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setImportResult(null);

    const payload = rows.map((row) => row.raw);
    const { data, error: importError } = await supabase.rpc("erp_expenses_import_csv", {
      p_rows: payload,
      p_validate_only: validateOnly,
    });

    if (importError) {
      setError(importError.message);
      setIsSubmitting(false);
      return;
    }

    const parsed = expenseImportResponseSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse import results.");
      setIsSubmitting(false);
      return;
    }

    setImportResult(parsed.data);
    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading import…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Import Expenses"
          description="Upload CSV files and validate or post expenses."
          rightActions={
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/erp/finance/expenses" style={secondaryButtonStyle}>
                Back to Expenses
              </Link>
              <button type="button" onClick={handleTemplateDownload} style={secondaryButtonStyle}>
                Download Template
              </button>
            </div>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>{error}</div>
        ) : null}

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#4b5563" }}>CSV File</span>
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
              style={inputStyle}
            />
          </label>
          {fileName ? <div style={{ color: "#6b7280" }}>Loaded file: {fileName}</div> : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={validateOnly} onChange={(event) => setValidateOnly(event.target.checked)} />
            Validate only (no database changes)
          </label>
          {parseError ? <div style={{ color: "#b91c1c" }}>{parseError}</div> : null}
          <button type="button" onClick={handleSubmit} style={primaryButtonStyle} disabled={rows.length === 0 || isSubmitting}>
            {isSubmitting ? "Submitting…" : "Process CSV"}
          </button>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Preview</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Row</th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Category</th>
                  <th style={tableHeaderCellStyle}>Payee</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
                      Upload a CSV to see preview rows.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.rowIndex}>
                      <td style={tableCellStyle}>{row.rowIndex}</td>
                      <td style={tableCellStyle}>{row.raw.expense_date}</td>
                      <td style={tableCellStyle}>{row.raw.amount}</td>
                      <td style={tableCellStyle}>{row.raw.category_code}</td>
                      <td style={tableCellStyle}>{row.raw.payee_name || row.raw.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{row.raw.reference || "—"}</td>
                      <td style={{ ...tableCellStyle, color: row.errors.length ? "#b91c1c" : "#16a34a" }}>
                        {row.errors.length ? row.errors.join(" ") : "OK"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {importResult ? (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Import Results</h3>
            <p style={{ color: "#6b7280", marginTop: 0 }}>
              Inserted: <strong>{importResult.inserted}</strong> · Rows: <strong>{importResult.rows.length}</strong>
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Row</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.rows.map((row) => (
                    <tr key={row.row_index}>
                      <td style={tableCellStyle}>{row.row_index}</td>
                      <td style={{ ...tableCellStyle, color: row.ok ? "#16a34a" : "#b91c1c" }}>{row.ok ? "OK" : "Error"}</td>
                      <td style={tableCellStyle}>{row.errors.length ? row.errors.join(" ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
