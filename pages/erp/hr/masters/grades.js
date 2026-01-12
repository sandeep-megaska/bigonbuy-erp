import MasterCrudPage from "../../../../components/erp/hr/MasterCrudPage";

export default function GradesMasterPage() {
  return (
    <MasterCrudPage
      title="Grades"
      description="Define grade bands to support compensation, promotions, and policy eligibility."
      apiPath="/api/erp/hr/masters/grades"
      itemLabel="grade"
      tileHint="Tip: Use grade codes to map salary bands and allowance rules."
      emptyMessage="No grades configured yet. Add your first grade band to start structuring compensation."
    />
  );
}
