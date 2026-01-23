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

const matchTabs = [
  { key: "AMAZON_SETTLEMENT", label: "Amazon disbursed", defaultRole: "AMAZON" },
  { key: "INDIFI_VIRTUAL_RECEIPT", label: "Indifi incoming", defaultRole: "INDIFI_IN" },
  { key: "INDIFI_RELEASE_TO_BANK", label: "Indifi outgoing", defaultRole: "INDIFI_OUT_BANK" },
  { key: "BANK_CREDIT", label: "Bank credits", defaultRole: "BANK_CREDIT" },
];

const matchRoles = [
  "AMAZON",
  "INDIFI_IN",
  "INDIFI_OUT_BANK",
  "INDIFI_OUT_INDIFI",
  "BANK_CREDIT",
  "OTHER",
];

type GmailToast = { type: "success" | "error"; message: string } | null;

type SelectedEvent = {
  role: string;
};

const headerAliases = {
  date: ["date", "transactiondate", "valuedate", "txnDate", "transaction_date"],
  description: ["description", "narration", "particulars", "details"],
  amount: ["amount", "amt", "transactionamount", "transaction_amount"],
  credit: ["credit", "creditamount", "cramount", "deposit", "credit_amount"],
  debit: ["debit", "debitamount", "dramount", "withdrawal", "debit_amount"],
  creditDebit: ["creditdebit", "crdr", "drcr", "type", "transactiontype"],
  reference: [
    "utr",
    "refno",
    "referencenumber",
    "utrrefno",
    "utrref",
    "refnumber",
    "rrn",
    "transactionid",
  ],
};

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

function parseAmount(value: unknown) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function parseDateValue(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    let year = Number.parseInt(match[3], 10);
    if (year < 100) year += 2000;
    const iso = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isCreditIndicator(value: unknown) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("credit") || normalized === "cr" || normalized === "c") return true;
  if (normalized.includes("debit") || normalized === "dr" || normalized === "d") return false;
  return null;
}

function parseCsvText(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const escapeCell = (value: string | number | null | undefined) => {
    const raw = value === null || value === undefined ? "" : String(value);
    const needsQuotes = /[\",\n]/.test(raw);
    const escaped = raw.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function FinanceSettlementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null as any);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [dailyMatrix, setDailyMatrix] = useState<any[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [gmailSettings, setGmailSettings] = useState<any>(null);
  const [gmailBatches, setGmailBatches] = useState<any[]>([]);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailToast, setGmailToast] = useState<GmailToast>(null);
  const [gmailResult, setGmailResult] = useState<any>(null);
  const [matchTab, setMatchTab] = useState(matchTabs[0].key);
  const [unmatchedEvents, setUnmatchedEvents] = useState<any[]>([]);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Record<string, SelectedEvent>>({});
  const [matchGroups, setMatchGroups] = useState<any[]>([]);
  const [matchGroupId, setMatchGroupId] = useState<string | null>(null);
  const [matchGroupDetail, setMatchGroupDetail] = useState<any>(null);
  const [matchGroupNote, setMatchGroupNote] = useState("");
  const [matchGroupSaving, setMatchGroupSaving] = useState(false);
  const [matchGroupMessage, setMatchGroupMessage] = useState("");
  const [mismatchFilterDate, setMismatchFilterDate] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return start;
  }, []);

  const [fromDate, setFromDate] = useState(formatDateInput(defaultFrom));
  const [toDate, setToDate] = useState(formatDateInput(today));

  const mismatchRows = useMemo(
    () => dailyMatrix.filter((row) => row.mismatch_amazon_indifi || row.mismatch_indifi_bank),
    [dailyMatrix]
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

  const fetchDailyMatrix = async () => {
    const { data, error: matrixError } = await supabase.rpc("erp_settlement_daily_matrix", {
      p_from: fromDate,
      p_to: toDate,
    });

    if (matrixError) {
      setStatusMessage(matrixError.message);
      return;
    }

    setDailyMatrix(data || []);
  };

  const fetchMatchGroups = async () => {
    const { data, error: groupsError } = await supabase.rpc("erp_settlement_match_groups_list", {
      p_from: fromDate,
      p_to: toDate,
    });

    if (groupsError) {
      setMatchGroupMessage(groupsError.message);
      return;
    }

    const groups = data || [];
    setMatchGroups(groups);
    if (!groups.length) {
      setMatchGroupId(null);
      return;
    }

    if (!matchGroupId || !groups.some((group: any) => group.id === matchGroupId)) {
      setMatchGroupId(groups[0].id);
    }
  };

  const fetchMatchGroupDetail = async (groupId: string | null) => {
    if (!groupId) {
      setMatchGroupDetail(null);
      setMatchGroupNote("");
      return;
    }

    const { data, error: detailError } = await supabase.rpc("erp_settlement_match_group_detail", {
      p_group_id: groupId,
    });

    if (detailError) {
      setMatchGroupMessage(detailError.message);
      return;
    }

    setMatchGroupDetail(data || null);
    setMatchGroupNote(data?.group?.note || "");
  };

  const fetchUnmatchedEvents = async (eventType: string, filterDate?: string | null) => {
    setUnmatchedLoading(true);
    const filterFrom = filterDate || fromDate;
    const filterTo = filterDate || toDate;

    const { data, error: unmatchedError } = await supabase.rpc(
      "erp_settlement_unmatched_events_list",
      {
        p_from: filterFrom,
        p_to: filterTo,
        p_event_type: eventType,
      }
    );

    if (unmatchedError) {
      setMatchGroupMessage(unmatchedError.message);
    } else {
      setUnmatchedEvents(data || []);
      setSelectedEvents({});
    }

    setUnmatchedLoading(false);
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
    fetchDailyMatrix();
    fetchGmailData();
    fetchMatchGroups();
    fetchUnmatchedEvents(matchTab, mismatchFilterDate);
  }, [ctx?.companyId, fromDate, toDate]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchMatchGroupDetail(matchGroupId);
  }, [ctx?.companyId, matchGroupId]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchUnmatchedEvents(matchTab, mismatchFilterDate);
  }, [ctx?.companyId, matchTab, mismatchFilterDate]);

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
      await fetchDailyMatrix();
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

    const csvText = await file.text();
    const csvRows = parseCsvText(csvText);
    if (!csvRows.length) {
      setUploadMessage("CSV is empty.");
      setUploading(false);
      return;
    }

    const headers = csvRows[0];
    const dateHeader = findHeader(headers, headerAliases.date);
    const amountHeader = findHeader(headers, headerAliases.amount);
    const creditHeader = findHeader(headers, headerAliases.credit);
    const debitHeader = findHeader(headers, headerAliases.debit);
    const creditDebitHeader = findHeader(headers, headerAliases.creditDebit);
    const referenceHeader = findHeader(headers, headerAliases.reference);
    const descriptionHeader = findHeader(headers, headerAliases.description);

    if (!dateHeader || (!amountHeader && !creditHeader)) {
      setUploadMessage("CSV missing required columns.");
      setUploading(false);
      return;
    }

    const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]));

    const events = csvRows.slice(1).flatMap((row) => {
      const getCell = (header: string | null) => (header ? row[headerIndex[header]] ?? "" : "");

      const eventDate = parseDateValue(getCell(dateHeader));
      if (!eventDate) return [];

      const creditIndicator = creditDebitHeader ? isCreditIndicator(getCell(creditDebitHeader)) : null;
      const creditAmount = creditHeader ? parseAmount(getCell(creditHeader)) : null;
      const debitAmount = debitHeader ? parseAmount(getCell(debitHeader)) : null;
      const baseAmount = amountHeader ? parseAmount(getCell(amountHeader)) : null;

      let amount = creditAmount ?? baseAmount;
      if (amount === null) return [];

      if (creditIndicator === false) return [];
      if (creditIndicator === null && debitAmount && debitAmount > 0 && !creditAmount) return [];

      amount = Math.abs(amount);
      if (!Number.isFinite(amount) || amount <= 0) return [];

      const narration = descriptionHeader ? String(getCell(descriptionHeader)).trim() : "";
      const referenceNo = referenceHeader ? String(getCell(referenceHeader)).trim() : "";

      return [
        {
          date: eventDate,
          amount,
          narration,
          reference_no: referenceNo || null,
        },
      ];
    });

    if (!events.length) {
      setUploadMessage("No credit entries found in CSV.");
      setUploading(false);
      return;
    }

    const { data, error: importError } = await supabase.rpc("erp_settlement_bank_csv_import", {
      p_company_id: ctx.companyId,
      p_rows: events,
    });

    if (importError) {
      setUploadMessage(importError.message);
    } else {
      setUploadMessage(
        `Imported ${data?.inserted ?? 0} credits, skipped ${data?.skipped ?? 0}, errors ${
          data?.errors ?? 0
        }.`
      );
      form.reset();
      await fetchSettlementData();
      await fetchDailyMatrix();
      await fetchUnmatchedEvents(matchTab, mismatchFilterDate);
    }

    setUploading(false);
  };

  const handleGmailSync = async () => {
    setGmailSyncing(true);
    setGmailToast(null);
    setGmailResult(null);

    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setGmailToast({ type: "error", message: "You must be signed in to sync Gmail." });
      setGmailSyncing(false);
      return;
    }

    console.log("gmail sync token?", { has: Boolean(token), err: sessErr?.message });

    const query = new URLSearchParams({ start: fromDate, end: toDate });
    const response = await fetch(`/api/finance/settlements/gmail-sync-run?${query.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
      await fetchDailyMatrix();
      await fetchUnmatchedEvents(matchTab, mismatchFilterDate);
    }

    await fetchGmailData();
    setGmailSyncing(false);
  };

  const handleGmailConnect = async () => {
    setGmailConnecting(true);
    setGmailToast(null);

    const session = await supabase.auth.getSession();
    if (!session.data.session) {
      setGmailToast({ type: "error", message: "You must be signed in to connect Gmail." });
      setGmailConnecting(false);
      return;
    }

    const response = await fetch("/api/finance/settlements/gmail-connect", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();
    if (!response.ok || !result?.ok) {
      setGmailToast({ type: "error", message: result?.error || "Gmail connect failed." });
    } else {
      setGmailToast({ type: "success", message: "Gmail connected." });
      await fetchGmailData();
    }

    setGmailConnecting(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const handleCreateMatchGroup = async () => {
    setMatchGroupSaving(true);
    setMatchGroupMessage("");

    const { data, error: createError } = await supabase.rpc("erp_settlement_match_group_create", {
      p_note: matchGroupNote,
    });

    if (createError) {
      setMatchGroupMessage(createError.message);
    } else {
      setMatchGroupNote("");
      setMatchGroupId(data);
      await fetchMatchGroups();
    }

    setMatchGroupSaving(false);
  };

  const handleSaveGroupNote = async () => {
    if (!matchGroupId) return;
    setMatchGroupSaving(true);
    setMatchGroupMessage("");

    const { error: noteError } = await supabase.rpc("erp_settlement_match_group_note_set", {
      p_group_id: matchGroupId,
      p_note: matchGroupNote,
    });

    if (noteError) {
      setMatchGroupMessage(noteError.message);
    } else {
      await fetchMatchGroupDetail(matchGroupId);
    }

    setMatchGroupSaving(false);
  };

  const handleAddSelectedEvents = async () => {
    if (!matchGroupId) {
      setMatchGroupMessage("Select or create a match group first.");
      return;
    }

    const entries = Object.entries(selectedEvents);
    if (!entries.length) {
      setMatchGroupMessage("Select at least one event.");
      return;
    }

    setMatchGroupSaving(true);
    setMatchGroupMessage("");

    for (const [eventId, details] of entries) {
      const { error: linkError } = await supabase.rpc("erp_settlement_match_link_add", {
        p_group_id: matchGroupId,
        p_event_id: eventId,
        p_role: details.role,
      });
      if (linkError) {
        setMatchGroupMessage(linkError.message);
        break;
      }
    }

    await fetchMatchGroupDetail(matchGroupId);
    await fetchMatchGroups();
    await fetchUnmatchedEvents(matchTab, mismatchFilterDate);
    setSelectedEvents({});
    setMatchGroupSaving(false);
  };

  const handleRemoveLink = async (eventId: string) => {
    if (!matchGroupId) return;
    setMatchGroupSaving(true);
    setMatchGroupMessage("");

    const { error: removeError } = await supabase.rpc("erp_settlement_match_link_remove", {
      p_group_id: matchGroupId,
      p_event_id: eventId,
    });

    if (removeError) {
      setMatchGroupMessage(removeError.message);
    } else {
      await fetchMatchGroupDetail(matchGroupId);
      await fetchMatchGroups();
      await fetchUnmatchedEvents(matchTab, mismatchFilterDate);
    }

    setMatchGroupSaving(false);
  };

  const handleSetGroupStatus = async (status: string) => {
    if (!matchGroupId) return;
    setMatchGroupSaving(true);
    setMatchGroupMessage("");

    const { error: statusError } = await supabase.rpc("erp_settlement_match_group_set_status", {
      p_group_id: matchGroupId,
      p_status: status,
    });

    if (statusError) {
      setMatchGroupMessage(statusError.message);
    } else {
      await fetchMatchGroupDetail(matchGroupId);
      await fetchMatchGroups();
    }

    setMatchGroupSaving(false);
  };

  const handleExportDailyMatrix = () => {
    const rowsToExport = [
      [
        "Date",
        "Amazon disbursed",
        "Indifi incoming",
        "Indifi outgoing to bank",
        "Bank credits",
        "Mismatch Amazon vs Indifi",
        "Mismatch Indifi vs Bank",
      ],
      ...dailyMatrix.map((row) => [
        row.event_date,
        row.amazon_disbursed,
        row.indifi_virtual_received,
        row.indifi_out_to_bank,
        row.bank_credits,
        row.mismatch_amazon_indifi ? "Yes" : "No",
        row.mismatch_indifi_bank ? "Yes" : "No",
      ]),
    ];

    downloadCsv(`settlement-daily-matrix-${fromDate}-to-${toDate}.csv`, rowsToExport);
  };

  const handleExportMismatches = () => {
    const rowsToExport = [
      [
        "Date",
        "Amazon disbursed",
        "Indifi incoming",
        "Indifi outgoing to bank",
        "Bank credits",
        "Mismatch Amazon vs Indifi",
        "Mismatch Indifi vs Bank",
      ],
      ...mismatchRows.map((row) => [
        row.event_date,
        row.amazon_disbursed,
        row.indifi_virtual_received,
        row.indifi_out_to_bank,
        row.bank_credits,
        row.mismatch_amazon_indifi ? "Yes" : "No",
        row.mismatch_indifi_bank ? "Yes" : "No",
      ]),
    ];

    downloadCsv(`settlement-mismatches-${fromDate}-to-${toDate}.csv`, rowsToExport);
  };

  const handleToggleSelectEvent = (eventId: string, defaultRole: string) => {
    setSelectedEvents((prev) => {
      if (prev[eventId]) {
        const { [eventId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [eventId]: { role: defaultRole } };
    });
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
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Gmail User</p>
              <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
                {gmailSettings?.gmail_user || "Not set"}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Last Gmail Sync</p>
              <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
                {formatDateTime(gmailSettings?.gmail_last_synced_at)}
              </p>
            </div>
            {!gmailSettings?.gmail_connected ? (
              <button
                type="button"
                onClick={handleGmailConnect}
                style={secondaryButtonStyle}
                disabled={gmailConnecting}
              >
                {gmailConnecting ? "Connecting…" : "Connect Gmail"}
              </button>
            ) : null}
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: "0 0 4px" }}>Mismatch Monitor</h3>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
                Highlight days where Amazon ≠ Indifi incoming or Indifi → Bank ≠ Bank credits.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={secondaryButtonStyle} onClick={handleExportDailyMatrix}>
                Export Daily Matrix
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleExportMismatches}>
                Export Mismatches
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              {mismatchRows.length} mismatch day{mismatchRows.length === 1 ? "" : "s"} in range.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {mismatchRows.length === 0 ? (
                <span style={{ fontSize: 13, color: "#6b7280" }}>No mismatches found.</span>
              ) : (
                mismatchRows.map((row: any) => (
                  <button
                    key={row.event_date}
                    type="button"
                    style={{
                      ...secondaryButtonStyle,
                      borderColor: mismatchFilterDate === row.event_date ? "#1d4ed8" : "#d1d5db",
                      color: mismatchFilterDate === row.event_date ? "#1d4ed8" : "#374151",
                    }}
                    onClick={() => setMismatchFilterDate(row.event_date)}
                  >
                    {row.event_date}
                  </button>
                ))
              )}
              {mismatchFilterDate ? (
                <button
                  type="button"
                  style={{ ...secondaryButtonStyle, color: "#6b7280" }}
                  onClick={() => setMismatchFilterDate(null)}
                >
                  Clear mismatch filter
                </button>
              ) : null}
            </div>
          </div>

          <table style={{ ...tableStyle, marginTop: 12 }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Amazon Disbursed</th>
                <th style={tableHeaderCellStyle}>Indifi Incoming</th>
                <th style={tableHeaderCellStyle}>Indifi → Bank</th>
                <th style={tableHeaderCellStyle}>Bank Credits</th>
                <th style={tableHeaderCellStyle}>Mismatch</th>
              </tr>
            </thead>
            <tbody>
              {dailyMatrix.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No daily totals for this range.
                  </td>
                </tr>
              ) : (
                dailyMatrix.map((row) => (
                  <tr key={row.event_date}>
                    <td style={tableCellStyle}>{row.event_date}</td>
                    <td style={tableCellStyle}>₹ {formatCurrency(Number(row.amazon_disbursed || 0))}</td>
                    <td style={tableCellStyle}>
                      ₹ {formatCurrency(Number(row.indifi_virtual_received || 0))}
                    </td>
                    <td style={tableCellStyle}>₹ {formatCurrency(Number(row.indifi_out_to_bank || 0))}</td>
                    <td style={tableCellStyle}>₹ {formatCurrency(Number(row.bank_credits || 0))}</td>
                    <td style={tableCellStyle}>
                      {row.mismatch_amazon_indifi || row.mismatch_indifi_bank ? (
                        <span style={{ ...badgeStyle, backgroundColor: "#fef2f2", color: "#b91c1c" }}>
                          Mismatch
                        </span>
                      ) : (
                        <span style={{ ...badgeStyle, backgroundColor: "#ecfdf5", color: "#065f46" }}>
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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

        <section style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
          <div style={{ ...cardStyle, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Unmatched Events</h3>
              {mismatchFilterDate ? (
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  Filtered to {mismatchFilterDate}
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {matchTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  style={{
                    ...secondaryButtonStyle,
                    borderColor: matchTab === tab.key ? "#1d4ed8" : "#d1d5db",
                    color: matchTab === tab.key ? "#1d4ed8" : "#374151",
                  }}
                  onClick={() => setMatchTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <table style={{ ...tableStyle, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}></th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Narration</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Role</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedLoading ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading unmatched events…
                    </td>
                  </tr>
                ) : unmatchedEvents.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No unmatched events for this tab.
                    </td>
                  </tr>
                ) : (
                  unmatchedEvents.map((row) => {
                    const tabConfig = matchTabs.find((tab) => tab.key === matchTab);
                    const defaultRole = tabConfig?.defaultRole ?? "OTHER";
                    const selected = selectedEvents[row.id];

                    return (
                      <tr key={row.id}>
                        <td style={tableCellStyle}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected)}
                            onChange={() => handleToggleSelectEvent(row.id, defaultRole)}
                          />
                        </td>
                        <td style={tableCellStyle}>{row.event_date}</td>
                        <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                        <td style={tableCellStyle}>{row.narration || "—"}</td>
                        <td style={tableCellStyle}>₹ {formatCurrency(Number(row.amount || 0))}</td>
                        <td style={tableCellStyle}>
                          <select
                            value={selected?.role || defaultRole}
                            onChange={(event) =>
                              setSelectedEvents((prev) => ({
                                ...prev,
                                [row.id]: { role: event.target.value },
                              }))
                            }
                            style={inputStyle}
                            disabled={!selected}
                          >
                            {matchRoles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ ...cardStyle, padding: 16 }}>
            <h3 style={{ margin: "0 0 12px" }}>Current Match Group</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Select group</span>
                <select
                  value={matchGroupId || ""}
                  onChange={(event) => setMatchGroupId(event.target.value || null)}
                  style={inputStyle}
                >
                  <option value="">No group selected</option>
                  {matchGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.id.slice(0, 8)} • {group.status} • {group.link_count} links
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Group note</span>
                <textarea
                  value={matchGroupNote}
                  onChange={(event) => setMatchGroupNote(event.target.value)}
                  style={{ ...inputStyle, minHeight: 80 }}
                  placeholder="Add context about this match chain."
                />
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handleCreateMatchGroup}
                  disabled={matchGroupSaving}
                >
                  Create New Group
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={handleSaveGroupNote}
                  disabled={matchGroupSaving || !matchGroupId}
                >
                  Save Note
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handleAddSelectedEvents}
                  disabled={matchGroupSaving}
                >
                  Add Selected Events
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleSetGroupStatus("cleared")}
                  disabled={matchGroupSaving || !matchGroupId}
                >
                  Mark Cleared
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleSetGroupStatus("open")}
                  disabled={matchGroupSaving || !matchGroupId}
                >
                  Mark Open
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleSetGroupStatus("void")}
                  disabled={matchGroupSaving || !matchGroupId}
                >
                  Void Group
                </button>
              </div>

              {matchGroupMessage ? (
                <div style={{ fontSize: 13, color: "#b91c1c" }}>{matchGroupMessage}</div>
              ) : null}

              {matchGroupDetail?.group ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Status: {matchGroupDetail.group.status} • Opened{" "}
                  {formatDateTime(matchGroupDetail.group.opened_at)}
                </div>
              ) : null}

              <div>
                <p style={{ margin: "8px 0", fontWeight: 600 }}>Linked events</p>
                {matchGroupDetail?.links?.length ? (
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Role</th>
                        <th style={tableHeaderCellStyle}>Date</th>
                        <th style={tableHeaderCellStyle}>Type</th>
                        <th style={tableHeaderCellStyle}>Amount</th>
                        <th style={tableHeaderCellStyle}>Reference</th>
                        <th style={tableHeaderCellStyle}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchGroupDetail.links.map((link: any) => (
                        <tr key={link.id}>
                          <td style={tableCellStyle}>{link.role}</td>
                          <td style={tableCellStyle}>{link.event?.event_date}</td>
                          <td style={tableCellStyle}>{link.event?.event_type}</td>
                          <td style={tableCellStyle}>₹ {formatCurrency(Number(link.event?.amount || 0))}</td>
                          <td style={tableCellStyle}>{link.event?.reference_no || "—"}</td>
                          <td style={tableCellStyle}>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => handleRemoveLink(link.event?.id)}
                              disabled={matchGroupSaving}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
                    No events linked yet.
                  </p>
                )}
              </div>
            </div>
          </div>
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
