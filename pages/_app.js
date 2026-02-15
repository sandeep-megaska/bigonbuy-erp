import "../styles/globals.css";
import { useRouter } from "next/router";
import ErpShell from "../components/erp/ErpShell";

const normalizePath = (asPath) => {
  const p = asPath || "";
  return p.split("?")[0].split("#")[0];
};

const resolveErpModuleKey = (path) => {
  if (!path || !path.startsWith("/erp")) return null;

  // Longest-prefix matching first
  const rules = [
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

export default function App({ Component, pageProps }) {
  const router = useRouter();

  // asPath is the real URL; pathname can be generic on some routes
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
