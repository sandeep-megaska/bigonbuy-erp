import MasterCrudPage from "../../../../components/erp/hr/MasterCrudPage";

export default function DepartmentsMasterPage() {
  return (
    <MasterCrudPage
      title="Departments"
      description="Maintain departments to keep reporting lines, approvals, and headcount aligned."
      apiPath="/api/erp/hr/masters/departments"
      itemLabel="department"
      tileHint="Tip: Use consistent codes to sync with payroll and cost centers."
      emptyMessage="No departments added yet. Create your first department to organise reporting structures."
    />
  );
}
