import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";

export default function HrHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canManage = useMemo(() => isHr(ctx?.roleKey), [ctx]);
  const navItems = useMemo(() => buildNavItems(canManage), [canManage]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading HR…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR</p>
          <h1 style={titleStyle}>Human Resources</h1>
          <p style={subtitleStyle}>Manage employees, salary, leave, and payroll.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || "member"}</strong></p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to ERP Home</Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

      <section style={cardGridStyle}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} style={cardStyle}>
            <div style={cardIconStyle}>{item.icon}</div>
            <div style={{ flex: 1 }}>
              <h2 style={cardTitleStyle}>{item.title}</h2>
              <p style={cardDescriptionStyle}>{item.description}</p>
              {item.ctaLabel ? (
                <div style={{ marginTop: 10 }}>
                  <span style={cardCtaStyle}>{item.ctaLabel} →</span>
                </div>
              ) : null}
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

const containerStyle = {
  maxWidth: 960,
  margin: "80px auto",
  padding: "48px 56px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #f1f3f5",
  paddingBottom: 24,
  marginBottom: 32,
};

const buttonStyle = {
  padding: "12px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 32,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
};

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const cardStyle = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 18,
  backgroundColor: "#f9fafb",
  textAlign: "left",
  textDecoration: "none",
  color: "#111827",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
};

const cardIconStyle = {
  width: 42,
  height: 42,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  backgroundColor: "#e0f2fe",
  color: "#0ea5e9",
  fontWeight: "bold",
  fontSize: 18,
};

const cardTitleStyle = {
  margin: "2px 0 6px",
  fontSize: 18,
  color: "#111827",
};

const cardDescriptionStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
};

const cardCtaStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 8,
  background: "#111827",
  color: "#fff",
  fontWeight: 700,
  textDecoration: "none",
  fontSize: 14,
};

function buildNavItems(canManage) {
  const items = [
    {
      title: "Employees",
      description: "Manage employee directory and profiles.",
      href: "/erp/hr/employees",
      icon: "🧑‍💼",
    },
    {
      title: "Salary",
      description: "Maintain salary structures and components.",
      href: "/erp/hr/salary",
      icon: "💰",
    },
    {
      title: "Leave",
      description: "Configure leave types and requests.",
      href: "/erp/hr/leave",
      icon: "🌴",
    },
    {
      title: "Roles",
      description: "Manage ERP access roles.",
      href: "/erp/hr/roles",
      icon: "🛡️",
    },
    {
      title: "Payroll",
      description: "Run payroll and manage payouts.",
      href: "/erp/hr/payroll",
      icon: "📄",
    },
    {
      title: "Employee Logins",
      description: "Link employees to Supabase Auth users.",
      href: "/erp/hr/employee-logins",
      icon: "🔗",
    },
  ];

  if (canManage) {
    items.push({
      title: "Company Users & Access",
      description: "Invite employees and assign roles.",
      href: "/erp/admin/company-users",
      icon: "🛂",
      ctaLabel: "Manage",
    });
  }

  return items;
}
