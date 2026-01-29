import ErpShell from "../../components/erp/ErpShell";
import DeprecatedPageNotice from "../../components/erp/DeprecatedPageNotice";
import { pageContainerStyle } from "../../components/erp/uiStyles";

export default function ErpProductsPage() {
  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <DeprecatedPageNotice
          title="Products"
          newHref="/erp/inventory/products"
          message="This page is deprecated. Use Inventory Products instead."
        />
      </div>
    </ErpShell>
  );
}
