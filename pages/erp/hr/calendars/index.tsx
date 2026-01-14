import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type CalendarRow = {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  is_default: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type CountMap = Record<string, number>;

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
  const [holidayCounts, setHolidayCounts] = useState<CountMap>({});
  const [locationCounts, setLocationCounts] = useState<CountMap>({});
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
      .select("id, code, name, timezone, is_default")
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load calendars." });
      return;
    }

    const calendarRows = (data as CalendarRow[]) || [];
    setCalendars(calendarRows);

    await Promise.all([
      loadHolidayCounts(calendarRows),
      loadLocationCounts(calendarRows),
    ]);
  }

  async function loadHolidayCounts(calendarRows: CalendarRow[]) {
    if (!calendarRows.length) {
      setHolidayCounts({});
      return;
    }

    const { data, error } = await supabase
      .from("erp_calendar_holidays")
      .select("calendar_id");

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load holiday counts." });
      return;
    }

    const counts = (data || []).reduce<CountMap>((acc, row) => {
      const key = row.calendar_id as string;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    setHolidayCounts(counts);
  }

  async function loadLocationCounts(calendarRows: CalendarRow[]) {
    if (!calendarRows.length) {
      setLocationCounts({});
      return;
    }

    const { data, error } = await supabase
      .from("erp_calendar_locations")
      .select("calendar_id");

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load location counts." });
      return;
    }

    const counts = (data || []).reduce<CountMap>((acc, row) => {
      const key = row.calendar_id as string;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    setLocationCounts(counts);
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
        <h1 style={{ marginTop: 0 }}>Calendars</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <ErpNavBar access={access} roleKey={ctx?.roleKey} />
        <h1 style={{ marginTop: 0 }}>Calendars</h1>
        <p style={{ color: "#b91c1c" }}>Only HR/admin users can access calendars.</p>
        <Link href="/erp/hr" style={linkStyle}>← Back to HR Home</Link>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={titleStyle}>Calendars</h1>
          <p style={subtitleStyle}>Manage HR calendars, holidays, and mapped work locations.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={linkStyle}>← Back to HR Home</Link>
          <Link href="/erp/hr/calendars/new" style={primaryButtonStyle}>New Calendar</Link>
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
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {calendars.length ? (
                calendars.map((calendar) => (
                  <tr key={calendar.id}>
                    <td style={tdStyle}>{calendar.code}</td>
                    <td style={tdStyle}>{calendar.name}</td>
                    <td style={tdStyle}>{calendar.timezone || "—"}</td>
                    <td style={tdStyle}>{calendar.is_default ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{locationCounts[calendar.id] ?? 0}</td>
                    <td style={tdStyle}>{holidayCounts[calendar.id] ?? 0}</td>
                    <td style={tdStyle}>
                      <Link href={`/erp/hr/calendars/${calendar.id}`} style={linkStyle}>Edit</Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={emptyCellStyle} colSpan={7}>No calendars created yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const containerStyle = {
  maxWidth: 1120,
  margin: "72px auto",
  padding: "48px 56px 56px",
  borderRadius: 12,
  border: "1px solid #e7eaf0",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
};

const eyebrowStyle = {
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 34,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
  maxWidth: 560,
  lineHeight: 1.5,
};

const linkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: 14,
};

const buttonStyle = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const primaryButtonStyle = {
  ...linkStyle,
  backgroundColor: "#111827",
  color: "#fff",
  padding: "10px 16px",
  borderRadius: 8,
  fontWeight: 600,
  textAlign: "center" as const,
};

const tableWrapStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 14,
};

const thStyle = {
  textAlign: "left" as const,
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  color: "#111827",
  fontWeight: 600,
};

const tdStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

const emptyCellStyle = {
  padding: "20px",
  textAlign: "center" as const,
  color: "#6b7280",
};

const successBoxStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  backgroundColor: "#ecfdf5",
  color: "#047857",
  border: "1px solid #a7f3d0",
  marginBottom: 18,
};

const errorBoxStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  marginBottom: 18,
};
