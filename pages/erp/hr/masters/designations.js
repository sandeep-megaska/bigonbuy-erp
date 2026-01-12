import MasterCrudPage from "../../../../components/erp/hr/MasterCrudPage";

export default function DesignationsMasterPage() {
  return (
    <MasterCrudPage
      title="Designations"
      description="Standardise job titles for offer letters, org charts, and payroll workflows."
      apiPath="/api/erp/hr/masters/designations"
      itemLabel="designation"
      tileHint="Tip: Keep designations aligned with grade bands for consistent compensation planning."
      emptyMessage="No designations found. Add your first designation to define job titles."
    />
  );
}
