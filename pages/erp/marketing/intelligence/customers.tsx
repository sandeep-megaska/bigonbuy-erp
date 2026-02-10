import IntelligenceTablePage from "../../../../components/erp/marketing/IntelligenceTablePage";

const currency = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function MarketingIntelligenceCustomersPage() {
  return (
    <IntelligenceTablePage
      title="Marketing Intelligence · Top Customers"
      description="Read-only customer intelligence scores (LTV, repeat propensity, and churn risk)."
      endpoint="/api/erp/marketing/intelligence/customers"
      defaultSort="ltv"
      columns={[
        { key: "customer_key", label: "Customer" },
        { key: "ltv", label: "LTV", format: currency },
        { key: "orders_count", label: "Orders" },
        { key: "aov", label: "AOV", format: currency },
        { key: "repeat_probability", label: "Repeat Probability" },
        { key: "churn_risk", label: "Churn Risk" },
        { key: "preferred_sku", label: "Preferred SKU" },
        { key: "top_city", label: "Top City" },
        { key: "last_order_at", label: "Last Order At" },
      ]}
    />
  );
}
