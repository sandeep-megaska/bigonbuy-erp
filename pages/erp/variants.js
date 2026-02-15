import DeprecatedPageNotice from "../../components/erp/DeprecatedPageNotice";
import { pageContainerStyle } from "../../components/erp/uiStyles";

export default function ErpVariantsPage() {
  return (
    <>
      <div style={pageContainerStyle}>
        <DeprecatedPageNotice
          title="Variants"
          newHref="/erp/inventory/skus"
          message="This page is deprecated. Use Inventory SKUs instead."
        />
      </div>
    </>
  );
}
