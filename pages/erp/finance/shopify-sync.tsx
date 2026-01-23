import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

type BackfillResult = {
  ok: boolean;
  fetched?: number;
  upserted?: number;
  errors?: number;
  error?: string;
};

export default function ShopifySyncPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [fromDate, setFromDate] = useState(daysAgo(7));
  const [toDate, setToDate] = useState(today());
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleBackfill = async () => {
    setIsRunning(true);
    setError(null);
    setBackfillResult(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setError("You must be signed in to run backfill.");
      setIsRunning(false);
      return;
    }

    try {
      const response = await fetch("/api/shopify/backfill-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ from: fromDate, to: toDate }),
      });

      const result = (await response.json()) as BackfillResult;
      setBackfillResult(result);

      if (!response.ok || !result.ok) {
        setError(result.error || "Shopify backfill failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shopify backfill failed.");
    }

    setIsRunning(false);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Shopify sync…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Shopify Orders Sync"
          description="Backfill Shopify orders into the ERP ledger before GST generation."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Backfill Shopify Orders</h2>
          <p style={subtitleStyle}>Choose the date range to ingest Shopify orders into the ledger.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
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
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleBackfill}
            disabled={!canWrite || isRunning}
          >
            {isRunning ? "Backfilling…" : "Backfill Orders"}
          </button>
          {!canWrite && (
            <p style={{ color: "#b91c1c", marginTop: 12 }}>
              You need finance/admin/owner access to run Shopify backfills.
            </p>
          )}
          {error && <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
        </section>

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Latest Result</h3>
          {backfillResult?.ok ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Fetched: {backfillResult.fetched ?? 0}</li>
              <li>Upserted: {backfillResult.upserted ?? 0}</li>
              <li>Errors: {backfillResult.errors ?? 0}</li>
            </ul>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>
              Run a backfill to see ingestion counts.
            </p>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
