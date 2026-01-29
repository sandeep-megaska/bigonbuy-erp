import ErpShell from "../../components/erp/ErpShell";
import DeprecatedPageNotice from "../../components/erp/DeprecatedPageNotice";
import { pageContainerStyle } from "../../components/erp/uiStyles";

export default function ErpInventoryPage() {
  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <DeprecatedPageNotice
          title="Inventory"
          newHref="/erp/inventory/dashboard"
          message="This page is deprecated. Use Inventory Dashboard instead."
        />
      </div>
    </ErpShell>
  );
}
