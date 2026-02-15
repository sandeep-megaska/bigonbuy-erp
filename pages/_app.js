import "../styles/globals.css";
import { useRouter } from "next/router";
import ErpShell from "../components/erp/ErpShell";
import type { ErpModuleKey } from "../components/erp/ErpTopBar";

const resolveErpModuleKey = (path: string): ErpModuleKey | null => {
  if (!path.startsWith("/erp")) return null;

  // Longest-prefix matching first (more specific before less specific)
  const rules: Array<[string, ErpModuleKey]> = [
    ["/erp/marketing", "marketing"],
    ["/erp/finance", "finance"],
    ["/erp/oms", "oms"],
    ["/erp/hr", "hr"],
    ["/erp/ops", "ops"],
    ["/erp/admin", "admin"],
    ["/erp/employee", "employee"],
    ["/erp/my", "employee"],
    ["/erp", "workspace"],
  ];

  for (const [prefix, key] of rules) {
    if (path.startsWith(prefix)) return key;
  }
  return "workspace";
};

const normalizePath = (asPath: string) => {
  // remove query string and hash
  return asPath.split("?")[0]?.split("#")[0] ?? asPath;
};

export default function App({ Component, pageProps }: { Component: any; pageProps: any }) {
  const router = useRouter();

  // Use asPath for correct runtime path detection; pathname can be generic on dynamic routes
  const currentPath = normalizePath(router.asPath || router.pathname);
  const moduleKey = resolveErpModuleKey(currentPath);

  const isPrintRoute =
    currentPath.includes("/print") || currentPath.startsWith("/erp/finance/gst/invoice/");

  if (moduleKey && !isPrintRoute) {
    return (
      <ErpShell activeModule={moduleKey}>
        <Component {...pageProps} />
      </ErpShell>
    );
  }

  return <Component {...pageProps} />;
}
