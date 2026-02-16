import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { card, cardTitle } from "../../../../../components/erp/tw";
import { primaryButtonStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type AudienceExportConfig = {
  title: string;
  description: string;
  viewName:
    | "erp_mkt_audience_atc_30d_no_purchase_v1"
    | "erp_mkt_audience_purchasers_180d_v1"
    | "erp_mkt_audience_vip_buyers_180d_v1";
  filenamePrefix: string;
};

type AudienceRow = {
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  source: string | null;
  last_event_at: string | null;
};

const DEFAULT_LIMIT = 50_000;
const MAX_LIMIT = 100_000;

const exportsConfig: readonly AudienceExportConfig[] = [
  {
    title: "ATC Audience (30D, exclude purchasers 180D)",
    description:
      "People with AddToCart/InitiateCheckout events in the last 30 days, excluding anyone who purchased in the last 180 days.",
    viewName: "erp_mkt_audience_atc_30d_no_purchase_v1",
    filenamePrefix: "audience_atc_30d_no_purchase",
  },
  {
    title: "Purchasers Audience (180D)",
    description: "All purchasers from supported channels in the last 180 days.",
    viewName: "erp_mkt_audience_purchasers_180d_v1",
    filenamePrefix: "audience_purchasers_180d",
  },
  {
    title: "VIP Buyers Audience (Top 20% revenue, 180D)",
    description: "Top 20% buyers by blended 180-day revenue for high-value retention and upsell campaigns.",
    viewName: "erp_mkt_audience_vip_buyers_180d_v1",
    filenamePrefix: "audience_vip_buyers_180d",
  },
] as const;

const csvColumns: Array<keyof AudienceRow> = ["email", "phone", "city", "state", "zip", "country", "source", "last_event_at"];

const escapeCsvValue = (value: string | null) => {
  const raw = value ?? "";
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
};

const buildAudienceCsv = (rows: AudienceRow[]) => {
  const header = csvColumns.join(",");
  const body = rows.map((row) => csvColumns.map((column) => escapeCsvValue(row[column])).join(",")).join("\n");
  return `${header}\n${body}`;
};

export default function MarketingMetaAudiencesExportPage() {
  const router = useRouter();
  const [rowLimitInput, setRowLimitInput] = useState(String(DEFAULT_LIMIT));
  const [isExportingView, setIsExportingView] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resolvedLimit = useMemo(() => {
    const parsed = Number.parseInt(rowLimitInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
  }, [rowLimitInput]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const companyContext = await getCompanyContext(session);
      if (!active) return;
      if (!companyContext.companyId) {
        await router.replace("/erp");
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleExport = async (item: AudienceExportConfig) => {
    setErrorMessage(null);
    setIsExportingView(item.viewName);

    try {
      const { data, error } = await supabase
        .from(item.viewName)
        .select("email, phone, city, state, zip, country, source, last_event_at")
        .or("email.not.is.null,phone.not.is.null")
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(resolvedLimit);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as AudienceRow[];
      const csv = buildAudienceCsv(rows);
      const dateTag = new Date().toISOString().slice(0, 10);
      triggerDownload(`${item.filenamePrefix}_${dateTag}.csv`, createCsvBlob(csv));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export CSV.";
      setErrorMessage(message);
    } finally {
      setIsExportingView(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <ErpPageHeader
          title="Marketing Intelligence · Audience CSV Exports"
          description="Download Meta Customer List CSV files for core retargeting and value-based audiences."
        />

        <section className={card}>
          <h2 className={cardTitle}>Export settings</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="audience-export-limit" className="text-sm font-medium text-slate-700">
              Row limit (max {MAX_LIMIT.toLocaleString()})
            </label>
            <input
              id="audience-export-limit"
              type="number"
              min={1}
              max={MAX_LIMIT}
              step={1}
              value={rowLimitInput}
              onChange={(event) => setRowLimitInput(event.target.value)}
              className="w-44 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="text-xs text-slate-500">Using {resolvedLimit.toLocaleString()} rows per export.</span>
          </div>
          {errorMessage ? <p className="mt-3 text-sm text-red-600">{errorMessage}</p> : null}
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          {exportsConfig.map((item) => (
            <section key={item.viewName} className={card}>
              <h2 className={cardTitle}>{item.title}</h2>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isExportingView === item.viewName ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => void handleExport(item)}
                disabled={isExportingView !== null}
              >
                {isExportingView === item.viewName ? "Exporting..." : "Export CSV"}
              </button>
            </section>
          ))}
        </div>

        <section className={card}>
          <h2 className={cardTitle}>How to use in Meta</h2>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>In Meta Ads Manager, go to Audiences → Create Audience → Custom Audience.</li>
            <li>Select Customer List, upload one exported CSV, and map fields if prompted.</li>
            <li>Name the audience with date/channel context, then wait for matching to complete.</li>
          </ul>
          <p className="mt-3 text-sm font-medium text-amber-700">
            Meta requires at least 100 matched users; matching may take time.
          </p>
        </section>
      </div>
    </>
  );
}
