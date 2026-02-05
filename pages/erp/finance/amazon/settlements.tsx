import { useEffect } from "react";
import { useRouter } from "next/router";

export default function AmazonSettlementsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/erp/finance/amazon/payouts");
  }, [router]);

  return null;
}
