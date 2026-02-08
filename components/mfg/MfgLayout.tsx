import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import MfgHeader from "./MfgHeader";
import { MfgContext, useMfgContext, type MfgContextValue } from "./mfgContext";

export { useMfgContext };

type MfgBranding = {
  vendor_logo_url: string | null;
  company_megaska_logo_url: string | null;
};

type MfgLayoutProps = {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  requestedVendorCode?: string;
};

const defaultBranding: MfgBranding = {
  vendor_logo_url: null,
  company_megaska_logo_url: null,
};

export default function MfgLayout({
  children,
  title,
  subtitle,
  actions,
  requestedVendorCode,
}: MfgLayoutProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [branding, setBranding] = useState<MfgBranding>(defaultBranding);

  const effectiveVendorCode =
    requestedVendorCode?.trim().toUpperCase() || vendorCode;

  const loadContext = async () => {
    setLoading(true);
    setError("");

    const meRes = await fetch("/api/mfg/auth/me");
    if (!meRes.ok) {
      router.replace("/mfg/login");
      return;
    }

    const meData = await meRes.json();
    if (!meData?.ok) {
      router.replace("/mfg/login");
      return;
    }

    if (meData?.must_reset_password) {
      router.replace("/mfg/reset-password");
      return;
    }

    const sessionVendorCode = String(meData.vendor_code || "").trim().toUpperCase();
    if (!sessionVendorCode) {
      setError("Vendor session invalid");
      setLoading(false);
      return;
    }

    const targetVendorCode = effectiveVendorCode || sessionVendorCode;

    if (requestedVendorCode && targetVendorCode !== sessionVendorCode) {
      router.replace(`/mfg/v/${sessionVendorCode}`);
      return;
    }

    setVendorCode(sessionVendorCode);

    const dashboardRes = await fetch(
      `/api/mfg/vendor/dashboard?vendor_code=${encodeURIComponent(targetVendorCode)}`
    );
    const dashboardJson = await dashboardRes.json();

    if (!dashboardRes.ok || !dashboardJson?.ok) {
      setError(dashboardJson?.error || "Failed to load vendor context");
      setLoading(false);
      return;
    }

    setVendorName(String(dashboardJson?.data?.vendor?.legal_name || ""));
    setBranding({
      vendor_logo_url: dashboardJson?.data?.branding?.vendor_logo_url || null,
      company_megaska_logo_url:
        dashboardJson?.data?.branding?.company_megaska_logo_url || null,
    });
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      await loadContext();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedVendorCode]);

  const signOut = async () => {
    await fetch("/api/mfg/auth/logout", { method: "POST" });
    router.replace("/mfg/login");
  };

  const contextValue = useMemo<MfgContextValue>(
    () => ({
      vendorCode,
      vendorName,
      branding,
      loading,
      error,
      signOut,
      refresh: loadContext,
    }),
    [vendorCode, vendorName, branding, loading, error]
  );

  return (
    <MfgContext.Provider value={contextValue}>
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <MfgHeader title={title} subtitle={subtitle} actions={actions} />
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "126px 24px 24px" }}>
          {children}
        </main>
      </div>
    </MfgContext.Provider>
  );
}
