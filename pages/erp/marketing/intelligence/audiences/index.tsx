import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { card, cardTitle } from "../../../../../components/erp/tw";
import { primaryButtonStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

type ExportItem = {
  key: string;
  title: string;
  description: string;
  href: string;
};

const DEMAND_EXPORTS: readonly ExportItem[] = [
  {
    key: "scale_skus",
    title: "Export Scale SKUs (CSV)",
    description: "Top demand steering SKUs to scale this cycle.",
    href: "/api/marketing/demand-steering/export-scale-skus.csv",
  },
  {
    key: "expand_cities",
    title: "Export Expand Cities (CSV)",
    description: "Top demand steering cities to expand this cycle.",
    href: "/api/marketing/demand-steering/export-expand-cities.csv",
  },
] as const;

const AUDIENCE_EXPORTS: readonly ExportItem[] = [
  {
    key: "atc_30d",
    title: "ATC 30D excl Purchasers 180D",
    description:
      "People with AddToCart/InitiateCheckout events in the last 30 days, excluding anyone who purchased in the last 180 days.",
    href: "/api/marketing/audiences/export-atc-30d.csv",
  },
  {
    key: "purchasers_180d",
    title: "Purchasers 180D",
    description: "All purchasers from supported channels in the last 180 days.",
    href: "/api/marketing/audiences/export-purchasers-180d.csv",
  },
  {
    key: "vip_180d",
    title: "VIP 180D",
    description: "Top 20% buyers by blended 180-day revenue for high-value retention and upsell campaigns.",
    href: "/api/marketing/audiences/export-vip-buyers.csv",
  },
] as const;

export default function MarketingExportsHubPage() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState<string | null>(null);

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

  const triggerExport = (item: ExportItem) => {
    setIsNavigating(item.key);
    window.location.href = item.href;
    window.setTimeout(() => setIsNavigating(null), 1200);
  };

  return (
    <div className="space-y-4">
      <ErpPageHeader
        title="Marketing Intelligence · Export Hub"
        description="Download Demand Steering and Audience CSV exports from one place."
      />

      <section className={card}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className={cardTitle}>Demand Steering Exports</h2>
            <p className="text-sm text-slate-600">Scale SKUs and Expand Cities actions for activation.</p>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {DEMAND_EXPORTS.map((item) => (
            <section key={item.key} className={card}>
              <h3 className={cardTitle}>{item.title}</h3>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isNavigating === item.key ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => triggerExport(item)}
                disabled={isNavigating !== null}
              >
                {isNavigating === item.key ? "Exporting..." : "Export CSV"}
              </button>
            </section>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Audience Exports</h2>
        <p className="text-sm text-slate-600">Download Meta-compatible customer list CSV files.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {AUDIENCE_EXPORTS.map((item) => (
            <section key={item.key} className={card}>
              <h3 className={cardTitle}>{item.title}</h3>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isNavigating === item.key ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => triggerExport(item)}
                disabled={isNavigating !== null}
              >
                {isNavigating === item.key ? "Exporting..." : "Export CSV"}
              </button>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
