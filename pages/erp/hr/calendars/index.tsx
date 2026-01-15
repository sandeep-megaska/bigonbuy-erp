import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type CalendarRow = {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  is_default: boolean;
  erp_calendar_locations?: { count: number }[] | { count: number } | null;
  erp_calendar_holidays?: { count: number }[] | { count: number } | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function HrCalendarsListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

      await loadCalendars();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadCalendars() {
    const { data, error } = await supabase
      .from("erp_calendars")
      .select(
        "id, code, name, timezone, is_default, erp_calendar_locations(count), erp_calendar_holidays(count)"
      )
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load calendars." });
      return;
    }

    setCalendars((data as CalendarRow[]) || []);
  }

  function resolveCount(value?: { count: number }[] | { count: number } | null) {
    if (!value) return 0;
    if (Array.isArray(value)) return value[0]?.count ?? 0;
    return value.count ?? 0;
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading calendars…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR Calendars</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Calendars</p>
        <h1 style={titleStyle}>Attendance Calendars</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Calendars</p>
          <h1 style={titleStyle}>Attendance Calendars</h1>
          <p style={subtitleStyle}>Maintain working calendars, holidays, and location mappings.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={linkStyle}>
            ← Back to HR Home
          </Link>
          <Link href="/erp/hr/calendars/new" style={primaryButtonStyle}>
            New Calendar
          </Link>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Timezone</th>
                <th style={thStyle}>Default</th>
                <th style={thStyle}>Mapped Locations</th>
                <th style={thStyle}>Holidays</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {calendars.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: "center" }}>
                    No calendars created yet.
                  </td>
                </tr>
              ) : (
                calendars.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.code}</td>
                    <td style={tdStyle}>{row.name}</td>
                    <td style={tdStyle}>{row.timezone || "—"}</td>
                    <td style={tdStyle}>{row.is_default ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{resolveCount(row.erp_calendar_locations)}</td>
                    <td style={tdStyle}>{resolveCount(row.erp_calendar_holidays)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <Link href={`/erp/hr/calendars/${row.id}`} style={smallButtonStyle}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "32px 36px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-start",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 20,
  marginBottom: 20,
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "6px 0 8px", fontSize: 30, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontWeight: 600,
  backgroundColor: "#f9fafb",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const smallButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  color: "#111827",
  textDecoration: "none",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
  textDecoration: "none",
  textAlign: "center",
};

const successBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#ecfdf3",
  color: "#166534",
  border: "1px solid #bbf7d0",
  marginBottom: 16,
};

const errorBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  marginBottom: 16,
};
