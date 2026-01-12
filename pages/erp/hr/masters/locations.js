import MasterCrudPage from "../../../../components/erp/hr/MasterCrudPage";

export default function LocationsMasterPage() {
  return (
    <MasterCrudPage
      title="Locations"
      description="Maintain statutory and branch locations for compliance, payroll, and employee mapping."
      apiPath="/api/erp/hr/masters/locations"
      itemLabel="location"
      tileHint="Tip: Track headcount by location to align statutory registrations."
      emptyMessage="No locations added yet. Add your first location for statutory reporting."
    />
  );
}
