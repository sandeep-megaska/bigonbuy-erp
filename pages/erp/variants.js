import ErpShell from "../../components/erp/ErpShell";
import DeprecatedPageNotice from "../../components/erp/DeprecatedPageNotice";
import { pageContainerStyle } from "../../components/erp/uiStyles";

export default function ErpVariantsPage() {
  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <DeprecatedPageNotice
          title="Variants"
          newHref="/erp/inventory/skus"
          message="This page is deprecated. Use Inventory SKUs instead."
        />
      </div>
    </ErpShell>
  );
}
