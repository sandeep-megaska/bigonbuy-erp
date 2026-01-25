import InventoryHealthPage from "../../../../components/inventory/InventoryHealthPage";
import { useInventoryNegativeStock } from "../../../../lib/erp/inventoryHealth";

export default function InventoryHealthNegativePage() {
  return <InventoryHealthPage mode="negative" useInventoryHook={useInventoryNegativeStock} />;
}
