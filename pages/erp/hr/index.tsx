import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { useCompanyBranding } from "../../../lib/erp/useCompanyBranding";
import { supabase } from "../../../lib/supabaseClient";

export default function HrHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employeeCount, setEmployeeCount] = useState("—");
  const [attendanceMarkedDays, setAttendanceMarkedDays] = useState("Not available yet");
  const [latestPayrollRun, setLatestPayrollRun] = useState<{
    label: string;
    status: string;
  } | null>(null);
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined as string | undefined,
  });
  const branding = useCompanyBranding();

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
        setError(context.membershipError || "No active company membership found for this user.");
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;

    if (!ctx?.companyId) {
      return () => {
        active = false;
      };
    }

    (async () => {
      const [employeeRes, attendanceRes, payrollRes] = await Promise.all([
        supabase.from("erp_employees").select("id", { count: "exact", head: true }),
        loadAttendanceSnapshot(),
        supabase
          .from("erp_payroll_runs")
          .select("id, year, month, status")
          .order("year", { ascending: false })
          .order("month", { ascending: false })
          .limit(1),
      ]);

      if (!active) return;

      if (employeeRes.error) {
        setEmployeeCount("—");
      } else {
        setEmployeeCount(String(employeeRes.count ?? 0));
      }

      if (attendanceRes.error) {
        setAttendanceMarkedDays("—");
      } else if (attendanceRes.data && attendanceRes.data.length > 0) {
        const markedDays = new Set(
          attendanceRes.data
            .filter((row) => row.status && row.status !== "unmarked")
            .map((row) => row.day)
        );
        setAttendanceMarkedDays(`${markedDays.size} days`);
      } else {
        setAttendanceMarkedDays("Not available yet");
      }

      if (payrollRes.error || !payrollRes.data || payrollRes.data.length === 0) {
        setLatestPayrollRun(null);
      } else {
        const latest = payrollRes.data[0];
        setLatestPayrollRun({
          label: `${latest.year}-${String(latest.month).padStart(2, "0")}`,
          status: latest.status,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading HR…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>HR</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={{ color: "#555" }}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
          <Link href="/" style={linkStyle}>Return to sign in</Link>
        </div>
      </ErpShell>
    );
  }

  const roleLabel = ctx.roleKey || access.roleKey || "member";
  const companyName = branding?.companyName || "—";
  const setupIncomplete = !branding?.companyName;
  const quickActions = [
    { label: "Add employee", href: "/erp/hr/employees", variant: "primary" },
    { label: "Mark attendance (month)", href: "/erp/hr/attendance", variant: "secondary" },
    { label: "Run payroll", href: "/erp/hr/payroll/runs", variant: "secondary" },
    {
      label: "Attendance → Payroll Summary",
      href: "/erp/hr/reports/attendance-payroll-summary",
      variant: "secondary",
    },
  ];
  const statusCards = [
    { label: "Employees", value: employeeCount },
    { label: "Attendance marked (month)", value: attendanceMarkedDays },
  ];

  if (latestPayrollRun) {
    statusCards.push({
      label: `Latest payroll run (${latestPayrollRun.label})`,
      value: latestPayrollRun.status,
    });
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR</p>
            <h1 style={h1Style}>Human Resources</h1>
            <p style={subtitleStyle}>
              Enterprise-ready HR and payroll operations for your India workforce.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <Link href="/erp" style={linkStyle}>
              ← Back to ERP Home
            </Link>
          </div>
        </header>

        <div style={sectionStackStyle}>
          <section style={dashboardCardStyle}>
            <div style={welcomeHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Welcome</p>
                <h2 style={h2Style}>Welcome, {ctx.email}</h2>
              </div>
              <div style={welcomeMetaStyle}>
                <p style={{ margin: 0, color: "#374151" }}>
                  Role: <strong>{roleLabel}</strong>
                </p>
                <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
                  Company: <strong>{companyName}</strong>
                </p>
              </div>
            </div>
            {setupIncomplete ? (
              <div style={alertStyle}>
                <span>Company setup is incomplete. Add brand and legal details to proceed.</span>
                <Link href="/erp/admin/company-settings" style={alertLinkStyle}>
                  Go to Company Settings
                </Link>
              </div>
            ) : null}
          </section>

          <section style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Quick actions</h2>
              <p style={sectionDescriptionStyle}>Shortcuts to the most common HR workflows.</p>
            </div>
            <div style={actionRowStyle}>
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  style={{
                    ...(action.variant === "primary" ? primaryButtonStyle : secondaryButtonStyle),
                    textDecoration: "none",
                  }}
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </section>

          <section style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Status</h2>
              <p style={sectionDescriptionStyle}>Track key HR metrics at a glance.</p>
            </div>
            <div style={statGridStyle}>
              {statusCards.map((card) => (
                <div key={card.label} style={statCardStyle}>
                  <p style={statLabelStyle}>{card.label}</p>
                  <p style={statValueStyle}>{card.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Tips &amp; getting started</h2>
              <p style={sectionDescriptionStyle}>Suggested next steps for HR onboarding.</p>
            </div>
            <ul style={tipsListStyle}>
              <li>Start with Designations, Leave Types, and Weekly Off Rules setup.</li>
              <li>Keep attendance calendars updated before each payroll run.</li>
              <li>Overtime (OT) is manual by design in payroll.</li>
            </ul>
          </section>
        </div>
      </div>
    </ErpShell>
  );
}

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 600 };

const sectionStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 28,
};

const dashboardCardStyle: CSSProperties = {
  ...sharedCardStyle,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const welcomeHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  flexWrap: "wrap",
  gap: 16,
};

const welcomeMetaStyle: CSSProperties = {
  textAlign: "right",
  minWidth: 220,
};

const alertStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fef3c7",
  color: "#92400e",
  fontSize: 14,
  fontWeight: 600,
};

const alertLinkStyle: CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 700,
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  color: "#111827",
};

const sectionDescriptionStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontSize: 14,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

const statGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const statCardStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  backgroundColor: "#f8fafc",
  border: "1px solid #e5e7eb",
};

const statLabelStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const statValueStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 20,
  fontWeight: 700,
  color: "#111827",
};

const tipsListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: "#4b5563",
  lineHeight: 1.7,
};

type AttendanceRow = {
  day: string;
  status: string | null;
};

async function loadAttendanceSnapshot() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const start = monthStart.toISOString().slice(0, 10);
  const end = monthEnd.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("erp_hr_attendance_days")
    .select("day, status")
    .gte("day", start)
    .lte("day", end);

  return {
    data: (data as AttendanceRow[]) ?? null,
    error,
  };
}
