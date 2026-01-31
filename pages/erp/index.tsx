import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import ErpShell from "../../components/erp/ErpShell";
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
} from "../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../lib/erpContext";
import { getCurrentErpAccess } from "../../lib/erp/nav";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";
import { supabase } from "../../lib/supabaseClient";

const buttonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "#dc2626",
  color: "#dc2626",
};

export default function ErpHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employeeCount, setEmployeeCount] = useState("—");
  const [designationCount, setDesignationCount] = useState("—");
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

    if (!ctx?.companyId || !access.isManager) {
      return () => {
        active = false;
      };
    }

    (async () => {
      const { count: employeeTotal, error: employeeError } = await supabase
        .from("erp_employees")
        .select("id", { count: "exact", head: true });

      if (!active) return;

      if (employeeError) {
        setEmployeeCount("—");
      } else {
        setEmployeeCount(String(employeeTotal ?? 0));
      }

      const { count: designationTotal, error: designationError } = await supabase
        .from("erp_designations")
        .select("id", { count: "exact", head: true });

      if (!active) return;

      if (designationError) {
        setDesignationCount("—");
      } else {
        setDesignationCount(String(designationTotal ?? 0));
      }
    })();

    return () => {
      active = false;
    };
  }, [access.isManager, ctx?.companyId]);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading account...</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>ERP Home</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={{ color: "#555" }}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
          <p style={{ color: "#374151", marginTop: 8 }}>
            Account not linked to company. Please ask admin to invite you.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" onClick={() => router.replace("/")} style={buttonStyle}>
              Back to Sign In
            </button>
          </div>
        </div>
      </ErpShell>
    );
  }

  const roleLabel = ctx.roleKey || access.roleKey || "member";
  const companyName = branding?.companyName || "—";
  const setupIncomplete = !branding?.companyName;
  const canAdmin = isAdmin(roleLabel);
  const quickActions = [
    { label: "Open Products", href: "/erp/products", variant: "primary" },
    { label: "Review Inventory", href: "/erp/inventory", variant: "secondary" },
    { label: "Manage Variants", href: "/erp/variants", variant: "secondary" },
  ];

  if (access.isManager) {
    quickActions.push({ label: "Open HR", href: "/erp/hr", variant: "secondary" });
  }

  if (canAdmin) {
    quickActions.push({
      label: "Company Settings",
      href: "/erp/company",
      variant: "secondary",
    });
  }

  const statusCards = access.isManager
    ? [
        { label: "Employees", value: employeeCount },
        { label: "Designations", value: designationCount },
        { label: "Company setup", value: setupIncomplete ? "Needs setup" : "Complete" },
      ]
    : [
        { label: "Role", value: roleLabel },
        { label: "Modules", value: "Workspace, Inventory" },
        { label: "Company setup", value: setupIncomplete ? "Needs setup" : "Complete" },
      ];

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>ERP Home</p>
            <h1 style={h1Style}>ERP Home</h1>
            <p style={subtitleStyle}>
              Track core operations and jump into the modules you need.
            </p>
          </div>
          <div style={{ textAlign: "right" }} />
        </header>

        <section style={sectionStackStyle}>
          <div style={dashboardCardStyle}>
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
                <span>
                  Company setup is incomplete. Add your legal or brand name to finish onboarding.
                </span>
                <Link href="/erp/company" style={alertLinkStyle}>
                  Go to Company Settings
                </Link>
              </div>
            ) : null}
          </div>

          <div style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Quick actions</h2>
              <p style={sectionDescriptionStyle}>Jump back into your daily workflows.</p>
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
          </div>

          <div style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Status</h2>
              <p style={sectionDescriptionStyle}>A quick snapshot of your workspace.</p>
            </div>
            <div style={statGridStyle}>
              {statusCards.map((card) => (
                <div key={card.label} style={statCardStyle}>
                  <p style={statLabelStyle}>{card.label}</p>
                  <p style={statValueStyle}>{card.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={dashboardCardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Getting started tips</h2>
              <p style={sectionDescriptionStyle}>
                Keep these next steps handy as you expand usage.
              </p>
            </div>
            <ul style={tipsListStyle}>
              <li>Confirm your catalog structure before bulk imports.</li>
              <li>Review inventory thresholds for fast-moving SKUs.</li>
              <li>HR and payroll workflows live under the HR module in the sidebar.</li>
            </ul>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}

const sectionStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
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
