import InventoryHealthPage from "../../../../components/inventory/InventoryHealthPage";
import { useInventoryAvailable } from "../../../../lib/erp/inventoryHealth";

export default function InventoryHealthAvailablePage() {
  return <InventoryHealthPage mode="available" useInventoryHook={useInventoryAvailable} showProblematicToggle />;
}
