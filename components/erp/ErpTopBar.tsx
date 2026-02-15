import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import CommandPalette from "./CommandPalette";
import { getCompanyContext } from "../../lib/erpContext";
import { supabase } from "../../lib/supabaseClient";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";
import { navLink, navLinkActive, shellHeader, topBarNavWrap, topBarUtilityButton } from "./tw";

export type ErpModuleKey = "workspace" | "marketing" | "ops" | "hr" | "employee" | "finance" | "oms" | "admin";

type ModuleLink = {
  key: ErpModuleKey;
  label: string;
  href: string;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const moduleLinks: ModuleLink[] = [
  { key: "workspace", label: "Workspace", href: "/erp" },
  { key: "marketing", label: "Marketing", href: "/erp/marketing/intelligence/growth-cockpit" },
  { key: "ops", label: "Ops", href: "/erp/ops" },
  { key: "hr", label: "HR", href: "/erp/hr" },
  { key: "finance", label: "Finance", href: "/erp/finance" },
  { key: "oms", label: "OMS", href: "/erp/oms/channels" },
];

export default function ErpTopBar({ activeModule }: { activeModule: ErpModuleKey }) {
  const router = useRouter();
  const branding = useCompanyBranding();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [showCompactSearch, setShowCompactSearch] = useState(false);
  const [paletteOpenNonce, setPaletteOpenNonce] = useState(0);
  const [companyContext, setCompanyContext] = useState<{ roleKey: string | null; companyId: string | null }>({
    roleKey: null,
    companyId: null,
  });
  const companyMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const context = await getCompanyContext();
      if (!active) return;
      setCompanyContext({ roleKey: context.roleKey ?? null, companyId: context.companyId ?? null });
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateCompact = () => setShowCompactSearch(window.innerWidth < 840);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!companyMenuRef.current) return;
      if (event.target instanceof Node && !companyMenuRef.current.contains(event.target)) {
        setCompanyMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    setCompanyMenuOpen(false);
  }, [router.asPath]);

  const companyName = branding?.companyName || "Company";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const navLinks = useMemo(
    () =>
      moduleLinks.map((module) => (
        <Link
          key={module.key}
          href={module.href}
          className={cx(navLink, activeModule === module.key && navLinkActive)}
        >
          {module.label}
        </Link>
      )),
    [activeModule]
  );

  return (
    <header className={shellHeader} data-erp-topbar>
      <div className="grid h-16 grid-cols-[auto_1fr_auto] items-center gap-3 overflow-hidden px-4 sm:gap-4 sm:px-5">
        <div className="flex min-w-[220px] items-center gap-3 overflow-hidden">
          {branding?.bigonbuyLogoUrl ? (
            <img
              src={branding.bigonbuyLogoUrl}
              alt="Bigonbuy logo"
              className="block h-8 max-h-8 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <div className="inline-flex h-8 items-center justify-center rounded-lg bg-slate-900 px-2.5 text-[11px] font-bold tracking-[0.12em] text-white">
              BIGONBUY
            </div>
          )}

          <div>
            <div className="text-xs font-bold uppercase tracking-[0.08em] text-slate-900">BIGONBUY ERP</div>
            <div className="text-xs text-slate-500">{companyName}</div>
          </div>

          {branding?.megaskaLogoUrl ? (
            <img
              src={branding.megaskaLogoUrl}
              alt="Megaska logo"
              className="block h-5 max-h-5 w-auto max-w-[140px] object-contain opacity-90"
            />
          ) : null}
        </div>

        <div className="min-w-0">
          <nav className={cx(topBarNavWrap, "w-full overflow-x-auto whitespace-nowrap")}>{navLinks}</nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={topBarUtilityButton}
            onClick={() => setPaletteOpenNonce((prev) => prev + 1)}
            aria-label="Open module search"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-200 text-[11px]">⌘</span>
            {!showCompactSearch ? <span>Search modules</span> : null}
            {!showCompactSearch ? <span className="text-[11px] font-medium text-slate-500">Ctrl/⌘ K</span> : null}
          </button>

          <div className="relative" ref={companyMenuRef}>
            <button
              type="button"
              onClick={() => setCompanyMenuOpen((prev) => !prev)}
              className={topBarUtilityButton}
              aria-expanded={companyMenuOpen}
              aria-haspopup="menu"
            >
              Company
              <span className="text-[10px] text-slate-500">{companyMenuOpen ? "▲" : "▼"}</span>
            </button>
            {companyMenuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-40 flex min-w-[200px] flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.12)]"
                role="menu"
              >
                <Link
                  href="/erp/company"
                  className="rounded-lg bg-slate-50 px-2.5 py-2 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-100"
                  role="menuitem"
                >
                  Company Settings Hub
                </Link>
                <Link
                  href="/erp/admin/company-users"
                  className="rounded-lg bg-slate-50 px-2.5 py-2 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-100"
                  role="menuitem"
                >
                  Users &amp; Access
                </Link>
              </div>
            ) : null}
          </div>

          {userEmail ? (
            <span className="hidden max-w-[180px] truncate text-xs text-slate-500 lg:inline">{userEmail}</span>
          ) : null}

          <button
            type="button"
            onClick={handleSignOut}
            className="erp-btn-focus inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:ring-indigo-500"
          >
            Sign Out
          </button>
        </div>
      </div>
      <CommandPalette
        roleKey={companyContext.roleKey}
        companyId={companyContext.companyId}
        openNonce={paletteOpenNonce}
      />
    </header>
  );
}
