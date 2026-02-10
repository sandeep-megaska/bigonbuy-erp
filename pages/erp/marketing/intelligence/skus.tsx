import IntelligenceTablePage from "../../../../components/erp/marketing/IntelligenceTablePage";

const number = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function MarketingIntelligenceSkusPage() {
  return (
    <IntelligenceTablePage
      title="Marketing Intelligence · Top SKUs"
      description="Read-only SKU performance signals for demand and contribution."
      endpoint="/api/erp/marketing/intelligence/skus"
      defaultSort="profitability_score"
      columns={[
        { key: "sku_code", label: "SKU" },
        { key: "orders_count", label: "Orders" },
        { key: "units_sold", label: "Units", format: number },
        { key: "revenue", label: "Revenue", format: number },
        { key: "velocity_30d", label: "Velocity 30d", format: number },
        { key: "repeat_rate", label: "Repeat Rate" },
        { key: "profitability_score", label: "Profitability" },
        { key: "inventory_pressure_score", label: "Inventory Pressure" },
      ]}
    />
  );
}
