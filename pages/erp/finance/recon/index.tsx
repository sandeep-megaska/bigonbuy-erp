import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { apiFetch } from "../../../../lib/erp/apiFetch";
import { PAYOUT_ENTITY_TYPES, PAYOUT_SOURCE_LABELS, type PayoutEvent, type PayoutSource } from "../../../../lib/erp/finance/payoutRecon";
import { supabase } from "../../../../lib/supabaseClient";

const last30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type VendorOption = { id: string; legal_name: string };

type BankUnmatchedRow = {
  bank_txn_id: string;
  txn_date: string | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  currency: string | null;
  description: string | null;
  reference_no: string | null;
  account_ref: string | null;
};

type PaymentUnmatchedRow = {
  payment_id: string;
  payment_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  currency: string | null;
  mode: string | null;
  reference_no: string | null;
  note: string | null;
  is_void: boolean | null;
  matched: boolean | null;
};

type PaymentUnallocatedRow = {
  payment_id: string;
  payment_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  allocated_total: number | null;
  unallocated_amount: number | null;
  matched: boolean | null;
  matched_bank_txn_id: string | null;
  matched_bank_txn_date: string | null;
  matched_bank_txn_description: string | null;
};

type InvoiceOutstandingRow = {
  invoice_id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_total: number | null;
  allocated_total: number | null;
  outstanding_amount: number | null;
  validation_status: string | null;
};

type ReconCounters = {
  bank_unmatched_count: number;
  payments_unmatched_count: number;
  payments_unallocated_count: number;
  invoices_outstanding_count: number;
  invoices_outstanding_total: number;
  payments_unallocated_total: number;
  payouts_unmatched_count?: number;
  payouts_suggested_count?: number;
  payouts_matched_count?: number;
  bank_credit_unmatched_count?: number;
};

type ReconSummary = {
  counters: ReconCounters;
  bank_unmatched: BankUnmatchedRow[];
  payments_unmatched: PaymentUnmatchedRow[];
  payments_unallocated: PaymentUnallocatedRow[];
  invoices_outstanding: InvoiceOutstandingRow[];
};

type ToastState = { type: "success" | "error"; message: string } | null;

type BankCreditUnmatchedRow = {
  bank_txn_id: string;
  txn_date: string | null;
  description: string | null;
  reference_no: string | null;
  credit: number;
  currency: string | null;
  source: "delhivery_cod" | "flipkart" | "myntra" | "snapdeal";
  extracted_ref: string | null;
};

type SuggestionRow = {
  id?: string;
  bank_txn_id?: string;
  txn_date?: string | null;
  value_date?: string | null;
  description?: string | null;
  reference_no?: string | null;
  credit?: number;
  amount?: number;
  score?: number;
  reason?: string;
  entity_id?: string;
  entity_type?: string;
  source?: PayoutSource;
  event_ref?: string;
  payout_date?: string | null;
};

type LoanOption = { id: string; lender_name: string | null; loan_ref: string | null; emi_amount: number | null };

type LoanRepaymentSuggestion = {
  bank_txn_id: string;
  txn_date: string | null;
  description: string | null;
  amount: number;
  loan_id: string | null;
  confidence: "high" | "medium" | "low";
  score: number;
  reason: string | null;
};

type LoanPaymentEvent = {
  id: string;
  loan_id: string;
  amount: number;
  event_date: string;
  expected_due_date: string | null;
  status: string;
  match_score: number | null;
  matched_bank_transaction_id: string | null;
  source: string;
  notes?: string | null;
  bank_txn_id?: string;
  principal_amount?: number | null;
  interest_amount?: number | null;
  posted_journal_id?: string | null;
};

type PayoutEventRow = {
  event_id: string;
  event_ref: string;
  payout_date: string;
  amount: number;
  currency: string | null;
  source: PayoutSource;
  status: "unmatched" | "suggested" | "matched" | string;
};

const defaultSummary: ReconSummary = {
  counters: {
    bank_unmatched_count: 0,
    payments_unmatched_count: 0,
    payments_unallocated_count: 0,
    invoices_outstanding_count: 0,
    invoices_outstanding_total: 0,
    payments_unallocated_total: 0,
  },
  bank_unmatched: [],
  payments_unmatched: [],
  payments_unallocated: [],
  invoices_outstanding: [],
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | null, currency = "INR") => {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    return `${currency} ${value.toLocaleString("en-IN")}`;
  }
};

export default function FinanceReconDashboardPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last30Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [fromDate, setFromDate] = useState(start);
  const [toDate, setToDate] = useState(end);
  const [vendorId, setVendorId] = useState("");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<ReconSummary>(defaultSummary);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [payoutsUnmatched, setPayoutsUnmatched] = useState<PayoutEvent[]>([]);
  const [bankCreditsUnmatched, setBankCreditsUnmatched] = useState<BankCreditUnmatchedRow[]>([]);
  const [payoutModal, setPayoutModal] = useState<{ open: boolean; event?: PayoutEvent }>({ open: false });
  const [bankModal, setBankModal] = useState<{ open: boolean; txn?: BankCreditUnmatchedRow }>({ open: false });
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [stubSuggestions, setStubSuggestions] = useState<Array<{ source: string; message: string }>>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isSubmittingMatch, setIsSubmittingMatch] = useState(false);
  const [loanSuggestions, setLoanSuggestions] = useState<LoanRepaymentSuggestion[]>([]);
  const [loanSuggestionsError, setLoanSuggestionsError] = useState<string | null>(null);
  const [loanOptions, setLoanOptions] = useState<LoanOption[]>([]);
  const [loanEvents, setLoanEvents] = useState<LoanPaymentEvent[]>([]);
  const [loanOverdueCount, setLoanOverdueCount] = useState(0);
  const [loanMatchModal, setLoanMatchModal] = useState<{ open: boolean; row?: LoanRepaymentSuggestion }>({ open: false });
  const [selectedLoanId, setSelectedLoanId] = useState<string>("");
  const [previewByEventId, setPreviewByEventId] = useState<Record<string, any>>({});
  const [payoutEvents, setPayoutEvents] = useState<PayoutEventRow[]>([]);
  const [isRunningPayoutSuggestions, setIsRunningPayoutSuggestions] = useState(false);
  const [isRunningLoanSuggestions, setIsRunningLoanSuggestions] = useState(false);

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

  useEffect(() => {
    let active = true;

    async function loadVendors() {
      if (!ctx?.companyId) return;

      const { data, error: loadError } = await supabase
        .from("erp_vendors")
        .select("id, legal_name")
        .eq("company_id", ctx.companyId)
        .order("legal_name");

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load vendors.");
        return;
      }

      setVendors((data || []) as VendorOption[]);
    }

    loadVendors();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const getAuthHeaders = (): HeadersInit => {
    const token = ctx?.session?.access_token;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const loadPayoutData = async (range?: { fromDate?: string; toDate?: string }) => {
    const effectiveFrom = range?.fromDate ?? fromDate;
    const effectiveTo = range?.toDate ?? toDate;
    const response = await apiFetch(`/api/finance/recon/payouts?from=${effectiveFrom}&to=${effectiveTo}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to load payout reconciliation data.");
    }
    setPayoutsUnmatched(payload.data?.payouts_unmatched || []);
    setBankCreditsUnmatched(payload.data?.bank_credit_unmatched || []);
    setSummary((prev) => ({
      ...prev,
      counters: {
        ...prev.counters,
        payouts_unmatched_count: payload.data?.counts?.payouts_unmatched_count || 0,
        bank_credit_unmatched_count: payload.data?.counts?.bank_credit_unmatched_count || 0,
      },
    }));
  };



  const loadPayoutEventSummary = async (range?: { fromDate?: string; toDate?: string }) => {
    const effectiveFrom = range?.fromDate ?? fromDate;
    const effectiveTo = range?.toDate ?? toDate;
    const response = await apiFetch(`/api/finance/recon/payout-events?from=${effectiveFrom}&to=${effectiveTo}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load payout event summary.");

    const rows = (payload.data || []) as PayoutEventRow[];
    setPayoutEvents(rows);
    const unmatched = rows.filter((row) => row.status === "unmatched").length;
    const suggested = rows.filter((row) => row.status === "suggested").length;
    const matched = rows.filter((row) => row.status === "matched").length;

    setSummary((prev) => ({
      ...prev,
      counters: {
        ...prev.counters,
        payouts_unmatched_count: unmatched,
        payouts_suggested_count: suggested,
        payouts_matched_count: matched,
      },
    }));
  };

  const loadLoanRepaymentData = async (range?: { fromDate?: string; toDate?: string }) => {
    const effectiveFrom = range?.fromDate ?? fromDate;
    const effectiveTo = range?.toDate ?? toDate;

    try {
      const eventsResponse = await apiFetch(
        `/api/finance/loans/repayments/events?company_id=${ctx?.companyId}&from=${effectiveFrom}&to=${effectiveTo}&status=suggested`,
        { method: "GET", headers: getAuthHeaders() }
      );
      const eventsPayload = await eventsResponse.json();
      if (!eventsResponse.ok || !eventsPayload?.ok) {
        throw new Error(eventsPayload?.error || "Failed to load loan repayment suggestions.");
      }
      const suggestedEvents = (eventsPayload.data || []) as LoanPaymentEvent[];
      setLoanSuggestions(
        suggestedEvents.map((row) => ({
          bank_txn_id: row.matched_bank_transaction_id || "",
          txn_date: row.event_date,
          description: row.source,
          amount: Number(row.amount || 0),
          loan_id: row.loan_id,
          confidence: "medium",
          score: Number(row.match_score || 0),
          reason: row.notes || null,
        }))
      );
      setLoanSuggestionsError(null);
    } catch (err) {
      setLoanSuggestions([]);
      setLoanSuggestionsError(err instanceof Error ? err.message : "Failed to load loan repayment suggestions.");
    }

    const { data: loansData } = await supabase
      .from("erp_loans")
      .select("id,lender_name,loan_ref,emi_amount")
      .eq("company_id", ctx?.companyId)
      .eq("is_void", false)
      .order("created_at", { ascending: false })
      .limit(200);
    setLoanOptions((loansData || []) as LoanOption[]);

    const eventsRes = await apiFetch(
      `/api/finance/loans/repayments/events?company_id=${ctx?.companyId}&from=${effectiveFrom}&to=${effectiveTo}`,
      { method: "GET", headers: getAuthHeaders() }
    );
    const eventsPayload = await eventsRes.json();
    if (!eventsRes.ok || !eventsPayload?.ok) {
      setLoanEvents([]);
    } else {
      setLoanEvents((eventsPayload.data || []) as LoanPaymentEvent[]);
    }

    const { count: overdueCount } = await supabase
      .from("erp_loan_schedules")
      .select("id", { count: "exact", head: true })
      .eq("company_id", ctx?.companyId)
      .eq("status", "due")
      .lt("due_date", new Date().toISOString().slice(0, 10))
      .eq("is_void", false);
    setLoanOverdueCount(overdueCount || 0);
  };

  const loadSummary = async (overrides?: {
    fromDate?: string;
    toDate?: string;
    vendorId?: string;
    query?: string;
  }) => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectiveVendor = overrides?.vendorId ?? vendorId;
    const effectiveQuery = overrides?.query ?? query;

    const { data, error: loadError } = await supabase.rpc("erp_finance_recon_summary", {
      p_from: effectiveFrom || null,
      p_to: effectiveTo || null,
      p_vendor_id: effectiveVendor || null,
      p_q: effectiveQuery.trim() || null,
      p_limit: 50,
      p_offset: 0,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load reconciliation summary.");
      setIsLoadingData(false);
      return;
    }

    setSummary((data as ReconSummary) || defaultSummary);
    try {
      await loadPayoutData({ fromDate: effectiveFrom, toDate: effectiveTo });
      await loadPayoutEventSummary({ fromDate: effectiveFrom, toDate: effectiveTo });
    } catch (payoutError) {
      setToast({ type: "error", message: payoutError instanceof Error ? payoutError.message : "Failed to load payout data." });
    }
    await loadLoanRepaymentData({ fromDate: effectiveFrom, toDate: effectiveTo });
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadSummary();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const handleRefresh = async (event: React.FormEvent) => {
    event.preventDefault();
    await loadSummary();
  };

  const handleReset = async () => {
    const nextFrom = start;
    const nextTo = end;
    setFromDate(nextFrom);
    setToDate(nextTo);
    setVendorId("");
    setQuery("");
    setToast(null);
    await loadSummary({ fromDate: nextFrom, toDate: nextTo, vendorId: "", query: "" });
  };

  const handleRowNavigate = (href: string) => {
    router.push(href);
  };

  const loanSuggestedCount = loanEvents.filter((row) => row.status === "suggested").length;
  const loanMatchedNotPostedCount = loanEvents.filter((row) => row.status === "matched").length;
  const loanNeedsAttention = loanSuggestions.slice(0, 20);
  const payoutNeedsAttention = payoutEvents
    .filter((row) => row.status === "suggested" || row.status === "unmatched")
    .slice(0, 20);

  const handleRunLoanSuggestions = async () => {
    setIsRunningLoanSuggestions(true);
    try {
      const response = await apiFetch("/api/finance/loans/repayments/run-suggestions", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ company_id: ctx?.companyId, from: fromDate, to: toDate }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to run loan repayment suggestions.");
      }
      setToast({ type: "success", message: "Loan repayment suggestions refreshed." });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to run loan repayment suggestions." });
    } finally {
      setIsRunningLoanSuggestions(false);
    }
  };

  const handleRunPayoutSuggestions = async () => {
    setIsRunningPayoutSuggestions(true);
    try {
      const response = await apiFetch("/api/finance/recon/payout-events", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: "suggest", from: fromDate, to: toDate }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to run payout suggestions.");
      setToast({ type: "success", message: "Marketplace payout suggestions refreshed." });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to run payout suggestions." });
    } finally {
      setIsRunningPayoutSuggestions(false);
    }
  };

  const loadPayoutSuggestions = async (event: PayoutEvent) => {
    setIsLoadingSuggestions(true);
    setSuggestions([]);
    setStubSuggestions([]);
    try {
      const response = await apiFetch(`/api/finance/recon/payout-suggestions?source=${event.source}&event_id=${event.event_id}`, {
        method: "GET",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load bank suggestions.");
      setSuggestions((payload.data?.candidates || []) as SuggestionRow[]);
      setStubSuggestions(payload.data?.stubs || []);
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to load suggestions." });
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const loadBankSuggestions = async (txn: BankCreditUnmatchedRow) => {
    setIsLoadingSuggestions(true);
    setSuggestions([]);
    setStubSuggestions([]);
    try {
      const response = await apiFetch(`/api/finance/recon/payout-suggestions?bank_txn_id=${txn.bank_txn_id}`, {
        method: "GET",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to load payout suggestions.");
      setSuggestions((payload.data?.payouts || []) as SuggestionRow[]);
      setStubSuggestions(payload.data?.stubs || []);
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to load suggestions." });
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleMatch = async (bankTxnId: string, entityType: string, entityId: string) => {
    setIsSubmittingMatch(true);
    try {
      const response = await apiFetch("/api/finance/recon/match", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ bank_txn_id: bankTxnId, entity_type: entityType, entity_id: entityId, confidence: "manual" }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to match payout.");
      setToast({ type: "success", message: "Payout matched successfully." });
      setPayoutModal({ open: false });
      setBankModal({ open: false });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to match payout." });
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  const handleMarketplaceCreditMatch = async (txn: BankCreditUnmatchedRow) => {
    setIsSubmittingMatch(true);
    try {
      const response = await apiFetch("/api/finance/recon/match", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          bank_txn_id: txn.bank_txn_id,
          entity_type: "payout_placeholder",
          source: txn.source,
          extracted_ref: txn.extracted_ref,
          confidence: "manual",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to reconcile marketplace/COD credit.");
      setToast({ type: "success", message: "Marketplace/COD credit reconciled." });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to reconcile marketplace/COD credit." });
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  const handleUnmatch = async (bankTxnId: string) => {
    setIsSubmittingMatch(true);
    try {
      const response = await apiFetch("/api/finance/recon/unmatch", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ bank_txn_id: bankTxnId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to unmatch payout.");
      setToast({ type: "success", message: "Payout unmatched successfully." });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to unmatch payout." });
    } finally {
      setIsSubmittingMatch(false);
    }
  };


  const eventByBankTxnId = useMemo(() => {
    const map = new Map<string, LoanPaymentEvent>();
    for (const row of loanEvents) {
      const key = row.bank_txn_id || row.matched_bank_transaction_id || "";
      if (key) map.set(key, row);
    }
    return map;
  }, [loanEvents]);

  const saveLoanSplit = async (eventId: string, principalAmount: number, interestAmount: number) => {
    const response = await apiFetch(`/api/finance/loans/repayments/${eventId}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ principal_amount: principalAmount, interest_amount: interestAmount }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to save split.");
    await loadSummary();
  };

  const createLoanRepaymentEvent = async () => {
    if (!loanMatchModal.row?.bank_txn_id || !selectedLoanId) return;
    setIsSubmittingMatch(true);
    try {
      const response = await apiFetch("/api/finance/loans/repayments/from-bank", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ bank_txn_id: loanMatchModal.row.bank_txn_id, loan_id: selectedLoanId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to create repayment event.");
      setToast({ type: "success", message: "Loan repayment event created and matched." });
      setLoanMatchModal({ open: false });
      setSelectedLoanId("");
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to create repayment event." });
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  const previewLoanEvent = async (eventId: string) => {
    const response = await apiFetch(`/api/finance/loans/repayments/${eventId}/preview`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to preview posting.");
    setPreviewByEventId((prev) => ({ ...prev, [eventId]: payload.data }));
  };

  const postLoanEvent = async (eventId: string) => {
    setIsSubmittingMatch(true);
    try {
      const response = await apiFetch(`/api/finance/loans/repayments/${eventId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Failed to post loan repayment.");
      setToast({ type: "success", message: `Posted: ${payload.data?.journal_no || payload.data?.journal_id || "journal created"}` });
      await loadSummary();
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to post loan repayment." });
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading reconciliation dashboard…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Recon Dashboard"
            description="Trace bank, payment, allocation, and invoice status."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Recon Dashboard"
          description="Monitor unmatched bank debits, vendor payments, allocations, and AP aging."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>
            {error}
          </div>
        ) : null}

        <section style={cardStyle}>
          <form onSubmit={handleRefresh} style={filterGridStyle}>
            <label style={filterLabelStyle}>
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                style={inputStyle}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label style={filterLabelStyle}>
              <span>To</span>
              <input
                type="date"
                value={toDate}
                style={inputStyle}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <label style={filterLabelStyle}>
              <span>Vendor</span>
              <select value={vendorId} style={inputStyle} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Reference, vendor, memo…"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle}>
                Refresh
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleReset}>
                Reset
              </button>
            </div>
          </form>
        </section>

        {toast && (
          <section style={{ ...cardStyle, borderColor: toast.type === "error" ? "#fecaca" : "#bbf7d0" }}>
            <strong>{toast.message}</strong>
          </section>
        )}


        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Marketplace payouts</h2>
              <p style={subtitleStyle}>Status snapshot and top payout events needing attention.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={secondaryButtonStyle} onClick={() => void handleRunPayoutSuggestions()} disabled={isRunningPayoutSuggestions}>
                Run suggestions
              </button>
              <Link href="/erp/finance/recon/payouts" style={primaryButtonStyle as any}>Go to details</Link>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={badgeStyle}>unmatched: {summary.counters.payouts_unmatched_count || 0}</span>
            <span style={badgeStyle}>suggested: {summary.counters.payouts_suggested_count || 0}</span>
            <span style={badgeStyle}>matched: {summary.counters.payouts_matched_count || 0}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Source</th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Ref</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payoutNeedsAttention.length === 0 ? (
                  <tr><td style={tableCellStyle} colSpan={5}>No suggested/unmatched payout events.</td></tr>
                ) : (
                  payoutNeedsAttention.map((row) => (
                    <tr key={`${row.source}-${row.event_id}`}>
                      <td style={tableCellStyle}><span style={badgeStyle}>{row.status}</span></td>
                      <td style={tableCellStyle}>{PAYOUT_SOURCE_LABELS[row.source]}</td>
                      <td style={tableCellStyle}>{formatDate(row.payout_date)}</td>
                      <td style={tableCellStyle}>{row.event_ref || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount, row.currency || "INR")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Loan repayments</h2>
              <p style={subtitleStyle}>Status snapshot and top suggested repayment matches.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={secondaryButtonStyle} onClick={() => void handleRunLoanSuggestions()} disabled={isRunningLoanSuggestions}>
                Run suggestions
              </button>
              <Link href="/erp/finance/loans" style={primaryButtonStyle as any}>Go to details</Link>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={badgeStyle}>suggested: {loanSuggestedCount}</span>
            <span style={badgeStyle}>matched: {loanMatchedNotPostedCount}</span>
            <span style={badgeStyle}>overdue schedules: {loanOverdueCount}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>Loan</th>
                  <th style={tableHeaderCellStyle}>Score</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {loanNeedsAttention.length === 0 ? (
                  <tr><td style={tableCellStyle} colSpan={5}>No suggested loan repayments.</td></tr>
                ) : (
                  loanNeedsAttention.map((row) => (
                    <tr key={row.bank_txn_id}>
                      <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{row.loan_id || "—"}</td>
                      <td style={tableCellStyle}>{row.score}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={sectionTitleStyle}>Unified Payout Recon</h2>
              <p style={subtitleStyle}>Use the dedicated payout events workspace for imports and suggestions.</p>
            </div>
            <Link href="/erp/finance/recon/payouts" style={primaryButtonStyle as any}>Open payout recon</Link>
          </div>
        </section>

        <section style={summaryGridStyle}>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Bank Unmatched</div>
            <div style={summaryValueStyle}>{summary.counters.bank_unmatched_count}</div>
            <div style={summaryHintStyle}>Debits waiting for payment match</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payments Unmatched</div>
            <div style={summaryValueStyle}>{summary.counters.payments_unmatched_count}</div>
            <div style={summaryHintStyle}>Payments without a bank match</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payments Unallocated</div>
            <div style={summaryValueStyle}>{summary.counters.payments_unallocated_count}</div>
            <div style={summaryHintStyle}>
              {formatAmount(summary.counters.payments_unallocated_total)} remaining to allocate
            </div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Invoices Outstanding</div>
            <div style={summaryValueStyle}>{summary.counters.invoices_outstanding_count}</div>
            <div style={summaryHintStyle}>
              {formatAmount(summary.counters.invoices_outstanding_total)} outstanding
            </div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payouts Unmatched</div>
            <div style={summaryValueStyle}>{summary.counters.payouts_unmatched_count || 0}</div>
            <div style={summaryHintStyle}>Unified payout events pending bank match</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payouts Suggested</div>
            <div style={summaryValueStyle}>{summary.counters.payouts_suggested_count || 0}</div>
            <div style={summaryHintStyle}>Ready for quick reviewer linking</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payouts Matched</div>
            <div style={summaryValueStyle}>{summary.counters.payouts_matched_count || 0}</div>
            <div style={summaryHintStyle}>Linked to bank transactions</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Bank Credits Unmatched (Payout candidates)</div>
            <div style={summaryValueStyle}>{summary.counters.bank_credit_unmatched_count || 0}</div>
            <div style={summaryHintStyle}>Credits likely to be payout inflows</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Loan EMIs Overdue</div>
            <div style={summaryValueStyle}>{loanOverdueCount}</div>
            <div style={summaryHintStyle}>Due schedule lines pending repayment</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Loan Suggestions</div>
            <div style={summaryValueStyle}>{loanSuggestedCount}</div>
            <div style={summaryHintStyle}>Repayments pending bank linking</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Loan Matched Not Posted</div>
            <div style={summaryValueStyle}>{loanMatchedNotPostedCount}</div>
            <div style={summaryHintStyle}>Matched events awaiting posting</div>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Bank Unmatched</h2>
              <p style={subtitleStyle}>Debits that have not been matched to vendor payments.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.bank_unmatched_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Debit</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                  <th style={tableHeaderCellStyle}>Account</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading bank transactions…
                    </td>
                  </tr>
                ) : summary.bank_unmatched.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No unmatched bank transactions found.
                    </td>
                  </tr>
                ) : (
                  summary.bank_unmatched.map((row) => (
                    <tr
                      key={row.bank_txn_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowNavigate("/erp/finance/bank/import")}
                    >
                      <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.debit, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.credit, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{row.account_ref || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Payments Unmatched</h2>
              <p style={subtitleStyle}>Vendor payments missing a bank match.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.payments_unmatched_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Mode</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Note</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading unmatched payments…
                    </td>
                  </tr>
                ) : summary.payments_unmatched.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No unmatched vendor payments.
                    </td>
                  </tr>
                ) : (
                  summary.payments_unmatched.map((row) => (
                    <tr
                      key={row.payment_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                    >
                      <td style={tableCellStyle}>{formatDate(row.payment_date)}</td>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{row.mode || "—"}</td>
                      <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{row.note || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Payments Unallocated</h2>
              <p style={subtitleStyle}>Matched payments that still need invoice allocations.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.payments_unallocated_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Allocated</th>
                  <th style={tableHeaderCellStyle}>Unallocated</th>
                  <th style={tableHeaderCellStyle}>Bank Match</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      Loading unallocated payments…
                    </td>
                  </tr>
                ) : summary.payments_unallocated.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      No unallocated payments.
                    </td>
                  </tr>
                ) : (
                  summary.payments_unallocated.map((row) => (
                    <tr key={row.payment_id} style={{ cursor: "pointer" }}>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatDate(row.payment_date)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {row.vendor_name || "—"}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.amount)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.allocated_total)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.unallocated_amount)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        <span
                          style={{
                            ...badgeStyle,
                            backgroundColor: row.matched ? "#dcfce7" : "#fee2e2",
                            color: row.matched ? "#166534" : "#991b1b",
                          }}
                        >
                          {row.matched ? "Matched" : "Unmatched"}
                        </span>
                      </td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push({
                              pathname: "/erp/finance/ap/outstanding",
                              query: {
                                vendorId: row.vendor_id || undefined,
                                q: row.vendor_name || undefined,
                              },
                            });
                          }}
                        >
                          Allocate
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Payouts Unmatched</h2>
              <p style={subtitleStyle}>Marketplace/PG payout events not yet linked to bank credits.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.payouts_unmatched_count || 0} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Source</th>
                  <th style={tableHeaderCellStyle}>Payout date</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr><td style={tableCellStyle} colSpan={5}>Loading unmatched payouts…</td></tr>
                ) : payoutsUnmatched.length === 0 ? (
                  <tr><td style={tableCellStyle} colSpan={5}>No unmatched payouts found.</td></tr>
                ) : (
                  payoutsUnmatched.map((row) => (
                    <tr key={`${row.source}-${row.event_id}`}>
                      <td style={tableCellStyle}>{PAYOUT_SOURCE_LABELS[row.source]}</td>
                      <td style={tableCellStyle}>{formatDate(row.payout_date)}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{row.event_ref}</td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => {
                            setPayoutModal({ open: true, event: row });
                            void loadPayoutSuggestions(row);
                          }}
                        >
                          Match
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Marketplace / COD Credits (unmatched)</h2>
              <p style={subtitleStyle}>Unmatched marketplace/COD credits detected from NEFT narration (Myntra, Flipkart, Delhivery, Snapdeal).</p>
            </div>
            <span style={badgeStyle}>{summary.counters.bank_credit_unmatched_count || 0} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                  <th style={tableHeaderCellStyle}>Detected Source</th>
                  <th style={tableHeaderCellStyle}>Extracted Ref</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr><td style={tableCellStyle} colSpan={6}>Loading unmatched bank credits…</td></tr>
                ) : bankCreditsUnmatched.length === 0 ? (
                  <tr><td style={tableCellStyle} colSpan={6}>No unmatched bank credits found.</td></tr>
                ) : (
                  bankCreditsUnmatched.map((row) => (
                    <tr key={row.bank_txn_id}>
                      <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.credit, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>
                        <span style={badgeStyle}>{PAYOUT_SOURCE_LABELS[row.source]}</span>
                      </td>
                      <td style={tableCellStyle}>
                        <span style={badgeStyle}>{row.extracted_ref || "—"}</span>
                      </td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => {
                            setBankModal({ open: true, txn: row });
                            void loadBankSuggestions(row);
                          }}
                        >
                          Suggest payouts
                        </button>
                        <button
                          type="button"
                          style={{ ...primaryButtonStyle, marginLeft: 8 }}
                          onClick={() => void handleMarketplaceCreditMatch(row)}
                          disabled={isSubmittingMatch}
                        >
                          Mark Reconciled
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>


        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Loan Repayments</h2>
              <p style={subtitleStyle}>Suggested EMI/loan debits, split capture, and finance posting.</p>
            </div>
            <span style={badgeStyle}>{loanSuggestions.length} suggestions</span>
          </div>
          {loanSuggestionsError ? (
            <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c", marginBottom: 12 }}>
              {loanSuggestionsError}
            </div>
          ) : null}
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Suggestion</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loanSuggestions.length === 0 ? (
                  <tr><td style={tableCellStyle} colSpan={6}>No loan repayment suggestions found.</td></tr>
                ) : (
                  loanSuggestions.map((row) => {
                    const event = eventByBankTxnId.get(row.bank_txn_id);
                    const splitOk = event && Math.abs(Number(event.principal_amount || 0) + Number(event.interest_amount || 0) - Number(event.amount || 0)) <= 0.01;
                    return (
                      <tr key={row.bank_txn_id}>
                        <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                        <td style={tableCellStyle}>{row.description || "—"}</td>
                        <td style={tableCellStyle}>{formatAmount(row.amount)}</td>
                        <td style={tableCellStyle}>loan: {row.loan_id || "—"} · {row.confidence} ({row.score})</td>
                        <td style={tableCellStyle}>
                          {!event ? "unmatched" : event.posted_journal_id ? "posted" : splitOk ? "ready to post" : "split missing"}
                        </td>
                        <td style={tableCellStyle}>
                          {!event ? (
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => {
                                setSelectedLoanId(row.loan_id || "");
                                setLoanMatchModal({ open: true, row });
                              }}
                            >
                              Match to loan
                            </button>
                          ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ display: "flex", gap: 8 }}>
                                <input
                                  style={{ ...inputStyle, width: 120 }}
                                  type="number"
                                  step="0.01"
                                  defaultValue={String(event.principal_amount ?? "")}
                                  placeholder="Principal"
                                  onBlur={(e) => void saveLoanSplit(event.id, Number(e.currentTarget.value || 0), Number(event.interest_amount || 0))}
                                />
                                <input
                                  style={{ ...inputStyle, width: 120 }}
                                  type="number"
                                  step="0.01"
                                  defaultValue={String(event.interest_amount ?? "")}
                                  placeholder="Interest"
                                  onBlur={(e) => void saveLoanSplit(event.id, Number(event.principal_amount || 0), Number(e.currentTarget.value || 0))}
                                />
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button type="button" style={secondaryButtonStyle} onClick={() => void previewLoanEvent(event.id)}>Preview</button>
                                <button
                                  type="button"
                                  style={primaryButtonStyle}
                                  onClick={() => void postLoanEvent(event.id)}
                                  disabled={Boolean(event.posted_journal_id) || isSubmittingMatch}
                                >
                                  Post
                                </button>
                              </div>
                              {previewByEventId[event.id] ? (
                                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(previewByEventId[event.id], null, 2)}</pre>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Invoices Outstanding</h2>
              <p style={subtitleStyle}>Open purchase invoices still awaiting allocations.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.invoices_outstanding_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Invoice</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Outstanding</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={5}>
                      Loading outstanding invoices…
                    </td>
                  </tr>
                ) : summary.invoices_outstanding.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={5}>
                      No outstanding invoices.
                    </td>
                  </tr>
                ) : (
                  summary.invoices_outstanding.map((row) => (
                    <tr
                      key={row.invoice_id}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        handleRowNavigate(
                          `/erp/finance/ap/outstanding?vendorId=${row.vendor_id || ""}&q=${encodeURIComponent(
                            row.invoice_no || ""
                          )}`
                        )
                      }
                    >
                      <td style={tableCellStyle}>{row.invoice_no || "Invoice"}</td>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatDate(row.invoice_date)}</td>
                      <td style={tableCellStyle}>{formatAmount(row.outstanding_amount)}</td>
                      <td style={tableCellStyle}>{row.validation_status || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>


        {loanMatchModal.open && loanMatchModal.row ? (
          <section style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <h3 style={{ marginTop: 0 }}>Match loan repayment</h3>
              <p style={subtitleStyle}>{loanMatchModal.row.description || "Select loan"}</p>
              <select value={selectedLoanId} style={inputStyle} onChange={(e) => setSelectedLoanId(e.target.value)}>
                <option value="">Select loan</option>
                {loanOptions.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {(loan.loan_ref || loan.lender_name || loan.id)} {loan.emi_amount ? `· EMI ${formatAmount(loan.emi_amount)}` : ""}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button type="button" style={primaryButtonStyle} onClick={() => void createLoanRepaymentEvent()} disabled={!selectedLoanId || isSubmittingMatch}>
                  Confirm Match
                </button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setLoanMatchModal({ open: false })}>Close</button>
              </div>
            </div>
          </section>
        ) : null}

        {payoutModal.open && payoutModal.event ? (
          <section style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <h3 style={{ marginTop: 0 }}>Match payout · {PAYOUT_SOURCE_LABELS[payoutModal.event.source]}</h3>
              <p style={subtitleStyle}>Select an unmatched bank credit for {payoutModal.event.event_ref}.</p>
              {isLoadingSuggestions ? <p>Loading suggestions…</p> : null}
              {!isLoadingSuggestions && suggestions.length === 0 ? <p>No bank credit suggestions found.</p> : null}
              <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                {suggestions.map((row) => (
                  <button
                    key={String(row.id || row.bank_txn_id)}
                    type="button"
                    style={{ ...secondaryButtonStyle, textAlign: "left" as const }}
                    onClick={() =>
                      void handleMatch(
                        String(row.id || row.bank_txn_id),
                        PAYOUT_ENTITY_TYPES[payoutModal.event!.source],
                        payoutModal.event!.event_id
                      )
                    }
                    disabled={isSubmittingMatch}
                  >
                    {formatDate((row.txn_date as string | null) || null)} · {formatAmount(Number(row.credit || 0))} · {row.reference_no || row.description || "—"}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setPayoutModal({ open: false })}>Close</button>
              </div>
            </div>
          </section>
        ) : null}

        {bankModal.open && bankModal.txn ? (
          <section style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <h3 style={{ marginTop: 0 }}>Suggest payouts for bank credit</h3>
              <p style={subtitleStyle}>Review payout candidates and match to this bank credit.</p>
              {isLoadingSuggestions ? <p>Loading suggestions…</p> : null}
              {!isLoadingSuggestions && suggestions.length === 0 ? <p>No payout suggestions found.</p> : null}
              <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                {suggestions.map((row, index) => (
                  <button
                    key={`${row.entity_id || row.id || index}`}
                    type="button"
                    style={{ ...secondaryButtonStyle, textAlign: "left" as const }}
                    onClick={() => void handleMatch(bankModal.txn!.bank_txn_id, String(row.entity_type), String(row.entity_id))}
                    disabled={isSubmittingMatch || !row.entity_id || !row.entity_type}
                  >
                    {(row.source ? PAYOUT_SOURCE_LABELS[row.source] : "Suggestion")} · {row.event_ref || row.reason || ""} · {formatAmount(Number(row.amount || 0))}
                  </button>
                ))}
              </div>
              {stubSuggestions.length ? (
                <div style={{ marginTop: 12 }}>
                  {stubSuggestions.map((stub) => (
                    <div key={stub.source} style={{ fontSize: 13, color: "#64748b" }}>
                      {stub.source}: {stub.message}
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setBankModal({ open: false })}>Close</button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
};

const filterLabelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#334155",
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const summaryCardStyle = {
  ...cardStyle,
  display: "grid",
  gap: 6,
};

const summaryLabelStyle = {
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#64748b",
};

const summaryValueStyle = {
  fontSize: 28,
  fontWeight: 700,
  color: "#0f172a",
};

const summaryHintStyle = {
  fontSize: 13,
  color: "#475569",
};

const sectionHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
  flexWrap: "wrap" as const,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 18,
  color: "#0f172a",
};


const modalOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 60,
};

const modalCardStyle = {
  ...cardStyle,
  width: "min(760px, 96vw)",
  maxHeight: "90vh",
  overflowY: "auto" as const,
};
