import ErpShell from "../../../components/erp/ErpShell";
import DeprecatedPageNotice from "../../../components/erp/DeprecatedPageNotice";
import { pageContainerStyle } from "../../../components/erp/uiStyles";

export default function ShopifySyncPage() {
  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <DeprecatedPageNotice
          title="Shopify Sync / Backfill"
          newHref="/erp/oms/shopify/orders"
          message="This page is deprecated. Use Shopify Orders instead."
        />
      </div>
    </ErpShell>
  );
}
