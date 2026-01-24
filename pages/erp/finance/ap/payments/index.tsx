import { useEffect } from "react";
import { useRouter } from "next/router";

export default function ApPaymentsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/erp/finance/vendor-payments");
  }, [router]);

  return null;
}
