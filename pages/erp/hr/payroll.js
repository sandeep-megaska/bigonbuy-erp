import { useEffect } from "react";
import { useRouter } from "next/router";

export default function HrPayrollRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/erp/hr/payroll/runs");
  }, [router]);

  return <div style={{ padding: 24 }}>Redirecting to payroll runs…</div>;
}
