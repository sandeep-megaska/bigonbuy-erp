import { useRouter } from "next/router";
import ErpShell from "../components/erp/ErpShell";

const getErpModuleKey = (pathname) => {
  if (!pathname.startsWith("/erp")) return null;
  if (pathname.startsWith("/erp/hr")) return "hr";
  if (pathname.startsWith("/erp/admin")) return "admin";
  if (pathname.startsWith("/erp/employee") || pathname.startsWith("/erp/my")) return "employee";
  if (pathname.startsWith("/erp/finance")) return "finance";
  if (pathname.startsWith("/erp/ops")) return "ops";
  if (pathname.startsWith("/erp/oms")) return "oms";
  return "workspace";
};

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const moduleKey = getErpModuleKey(router.pathname);

  const isPrintRoute =
    router.pathname.includes("/print") || router.pathname.startsWith("/erp/finance/gst/invoice/");

  if (moduleKey && !isPrintRoute) {
    return (
      <ErpShell activeModule={moduleKey}>
        <Component {...pageProps} />
      </ErpShell>
    );
  }

  return <Component {...pageProps} />;
}
