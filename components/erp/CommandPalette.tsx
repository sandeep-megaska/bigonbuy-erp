import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { COMMAND_PALETTE_ROUTES } from "../../lib/erp/nav/commandPaletteRegistry";
import { getAccessibleErpNavItems } from "../../lib/erp/nav/erpNavRegistry";

type PaletteRoute = (typeof COMMAND_PALETTE_ROUTES)[number];

type Props = {
  roleKey?: string | null;
  companyId?: string | null;
  openNonce?: number;
};

const RECENT_KEY = "erp.command_palette.recent";
const GROUP_ORDER = ["Inventory", "Finance", "HR", "Ops", "MFG", "Analytics"] as const;

export default function CommandPalette({ roleKey, companyId, openNonce = 0 }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);

  useEffect(() => {
    if (openNonce > 0) {
      setOpen(true);
    }
  }, [openNonce]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentHrefs(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setRecentHrefs([]);
    }
  }, []);

  const allowedHrefs = useMemo(() => {
    const allowed = new Set<string>();
    const items = getAccessibleErpNavItems({ roleKey, companyId, includeDeprecated: false });
    items.forEach((item) => allowed.add(item.href));
    COMMAND_PALETTE_ROUTES.filter((route) => route.group === "MFG").forEach((route) => {
      allowed.add(route.href);
    });
    return allowed;
  }, [companyId, roleKey]);

  const filteredRoutes = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = COMMAND_PALETTE_ROUTES.filter((route) => allowedHrefs.has(route.href));
    if (!query) return base;
    return base.filter((route) => {
      const haystack = `${route.title} ${route.group} ${route.keywords.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [allowedHrefs, search]);

  const recentRoutes = useMemo(() => {
    const hrefSet = new Set(filteredRoutes.map((route) => route.href));
    return recentHrefs
      .filter((href) => hrefSet.has(href))
      .map((href) => filteredRoutes.find((route) => route.href === href))
      .filter((route): route is PaletteRoute => Boolean(route));
  }, [recentHrefs, filteredRoutes]);

  const groupedRoutes = useMemo(() => {
    const groups = new Map<string, PaletteRoute[]>();
    filteredRoutes.forEach((route) => {
      if (!groups.has(route.group)) groups.set(route.group, []);
      groups.get(route.group)?.push(route);
    });
    return GROUP_ORDER.map((group) => ({ group, routes: groups.get(group) ?? [] })).filter(
      (entry) => entry.routes.length > 0
    );
  }, [filteredRoutes]);

  const onSelect = (href: string) => {
    setOpen(false);
    setSearch("");
    router.push(href);
    const nextRecent = [href, ...recentHrefs.filter((value) => value !== href)].slice(0, 6);
    setRecentHrefs(nextRecent);
    localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
  };

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={() => setOpen(false)}>
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()}>
        <div style={inputRowStyle}>
          <span style={searchIconStyle}>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search modules, routes, or commands…"
            style={inputStyle}
            autoFocus
          />
        </div>
        <div style={listStyle}>
          {recentRoutes.length > 0 ? (
            <section>
              <div style={groupHeadingStyle}>Recent</div>
              {recentRoutes.map((route) => (
                <button key={`recent-${route.href}`} type="button" style={itemStyle} onClick={() => onSelect(route.href)}>
                  <span style={badgeStyle}>{route.icon || "→"}</span>
                  <span style={itemMetaStyle}>{route.title}</span>
                </button>
              ))}
            </section>
          ) : null}

          {groupedRoutes.map(({ group, routes }) => (
            <section key={group}>
              <div style={groupHeadingStyle}>{group}</div>
              {routes.map((route) => (
                <button key={route.href} type="button" style={itemStyle} onClick={() => onSelect(route.href)}>
                  <span style={badgeStyle}>{route.icon || "→"}</span>
                  <span style={itemMetaStyle}>{route.title}</span>
                </button>
              ))}
            </section>
          ))}

          {groupedRoutes.length === 0 ? <div style={emptyStyle}>No matching routes.</div> : null}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 88 };
const dialogStyle: CSSProperties = { width: "min(680px, calc(100vw - 24px))", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb", boxShadow: "0 18px 40px rgba(15,23,42,0.18)", background: "#fff" };
const inputRowStyle: CSSProperties = { display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", padding: "10px 12px" };
const searchIconStyle: CSSProperties = { fontSize: 16, color: "#64748b", marginRight: 8 };
const inputStyle: CSSProperties = { border: "none", outline: "none", width: "100%", fontSize: 14 };
const listStyle: CSSProperties = { maxHeight: "60vh", overflowY: "auto", padding: "10px" };
const groupHeadingStyle: CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", margin: "8px 0 6px" };
const itemStyle: CSSProperties = { width: "100%", border: "none", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#111827", cursor: "pointer", background: "transparent", textAlign: "left" };
const badgeStyle: CSSProperties = { width: 26, height: 26, borderRadius: 8, display: "inline-flex", justifyContent: "center", alignItems: "center", background: "#f1f5f9", color: "#334155", fontSize: 11 };
const itemMetaStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const emptyStyle: CSSProperties = { color: "#64748b", fontSize: 13, padding: "8px 6px" };
