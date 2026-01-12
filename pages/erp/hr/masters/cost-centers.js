import MasterCrudPage from "../../../../components/erp/hr/MasterCrudPage";

export default function CostCentersMasterPage() {
  return (
    <MasterCrudPage
      title="Cost Centers"
      description="Align payroll spend and HR budgets with finance cost center structures."
      apiPath="/api/erp/hr/masters/cost-centers"
      itemLabel="cost center"
      tileHint="Tip: Keep cost centers aligned with finance GL for smoother reporting."
      emptyMessage="No cost centers yet. Add cost centers to align HR spend with finance reporting."
    />
  );
}
