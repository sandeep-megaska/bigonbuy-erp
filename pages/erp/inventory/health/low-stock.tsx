import InventoryHealthPage from "../../../../components/inventory/InventoryHealthPage";
import { useInventoryLowStock } from "../../../../lib/erp/inventoryHealth";

export default function InventoryHealthLowStockPage() {
  return <InventoryHealthPage mode="low" useInventoryHook={useInventoryLowStock} showShortage />;
}
