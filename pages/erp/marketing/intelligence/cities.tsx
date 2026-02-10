import IntelligenceTablePage from "../../../../components/erp/marketing/IntelligenceTablePage";

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function MarketingIntelligenceCitiesPage() {
  return (
    <IntelligenceTablePage
      title="Marketing Intelligence · Top Cities"
      description="Read-only city-level targeting signals built from Shopify + Amazon sales data."
      endpoint="/api/marketing/intelligence/cities"
      defaultSort="conversion_index"
      columns={[
        { key: "city", label: "City" },
        { key: "orders_count", label: "Orders" },
        { key: "revenue", label: "Revenue", format: number },
        { key: "aov", label: "AOV", format: number },
        { key: "conversion_index", label: "Conversion Index" },
      ]}
    />
  );
}
