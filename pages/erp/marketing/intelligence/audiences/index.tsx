import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { card, cardTitle } from "../../../../../components/erp/tw";
import { primaryButtonStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { CsvColumn, downloadCsv } from "../../../../../lib/erp/exportCsv";

type AudienceExportConfig = {
  title: string;
  description: string;
  filename: string;
  view: string;
};

type AudienceCsvRow = {
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  source: string | null;
  last_event_at: string | null;
};

const CSV_COLUMNS: CsvColumn<AudienceCsvRow>[] = [
  { header: "email", accessor: (row) => row.email },
  { header: "phone", accessor: (row) => row.phone },
  { header: "city", accessor: (row) => row.city },
  { header: "state", accessor: (row) => row.state },
  { header: "zip", accessor: (row) => row.zip },
  { header: "country", accessor: (row) => row.country },
  { header: "source", accessor: (row) => row.source },
  { header: "last_event_at", accessor: (row) => row.last_event_at },
];

const AUDIENCE_EXPORT_LIMIT_DEFAULT = 50000;
const AUDIENCE_EXPORT_LIMIT_MAX = 100000;

const AUDIENCE_EXPORT_LIMIT = Math.min(AUDIENCE_EXPORT_LIMIT_DEFAULT, AUDIENCE_EXPORT_LIMIT_MAX);

const exportsConfig: readonly AudienceExportConfig[] = [
  {
    title: "ATC Audience (30D, exclude purchasers 180D)",
    description:
      "People with AddToCart/InitiateCheckout events in the last 30 days, excluding anyone who purchased in the last 180 days.",
    filename: "meta_audience_atc_30d_no_purchase.csv",
    view: "erp_mkt_audience_atc_30d_no_purchase_v1",
  },
  {
    title: "Purchasers Audience (180D)",
    description: "All purchasers from supported channels in the last 180 days.",
    filename: "meta_audience_purchasers_180d.csv",
    view: "erp_mkt_audience_purchasers_180d_v1",
  },
  {
    title: "VIP Buyers Audience (Top 20% revenue, 180D)",
    description: "Top 20% buyers by blended 180-day revenue for high-value retention and upsell campaigns.",
    filename: "meta_audience_vip_buyers_180d.csv",
    view: "erp_mkt_audience_vip_buyers_180d_v1",
  },
] as const;

export default function MarketingMetaAudiencesExportPage() {
  const router = useRouter();
  const [isExportingView, setIsExportingView] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);


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
    setIsExportingView(item.view);

    try {
      const { data, error } = await supabase
        .from(item.view)
        .select("email,phone,city,state,zip,country,source,last_event_at")
        .or("email.not.is.null,phone.not.is.null")
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(AUDIENCE_EXPORT_LIMIT);

      if (error) {
        throw new Error(error.message || "Failed to export CSV.");
      }

      downloadCsv(item.filename, CSV_COLUMNS, (data ?? []) as AudienceCsvRow[]);
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
          <p className="text-sm text-slate-600">Use the buttons below to export each audience as CSV.</p>
          {errorMessage ? <p className="mt-3 text-sm text-red-600">{errorMessage}</p> : null}
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          {exportsConfig.map((item) => (
            <section key={item.view} className={card}>
              <h2 className={cardTitle}>{item.title}</h2>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isExportingView === item.view ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => void handleExport(item)}
                disabled={isExportingView !== null}
              >
                {isExportingView === item.view ? "Exporting..." : "Export CSV"}
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
