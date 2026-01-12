import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const MASTER_CARDS = [
  {
    title: "Departments",
    description: "Organise departments for reporting, headcount, and approvals.",
    href: "/erp/hr/masters/departments",
    icon: "🏢",
  },
  {
    title: "Designations",
    description: "Standardise job titles for letters, offers, and org charts.",
    href: "/erp/hr/masters/designations",
    icon: "🏷️",
  },
  {
    title: "Grades",
    description: "Define grade bands for compensation and career ladders.",
    href: "/erp/hr/masters/grades",
    icon: "📈",
  },
  {
    title: "Locations",
    description: "Maintain branch and statutory locations for compliance.",
    href: "/erp/hr/masters/locations",
    icon: "📍",
  },
  {
    title: "Cost Centers",
    description: "Map payroll costs to finance-ready cost centers.",
    href: "/erp/hr/masters/cost-centers",
    icon: "🧾",
  },
];

export default function HrMastersLandingPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });

  const canManage = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx?.roleKey]);

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading HR Masters…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>HR Masters</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR</p>
          <h1 style={titleStyle}>HR Masters</h1>
          <p style={subtitleStyle}>Build the core HR catalogues that drive payroll, compliance, and analytics.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to HR</Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

      {!canManage ? (
        <div style={{ marginBottom: 20 }}>
          <Banner>
            You can view master data, but only owner/admin/HR roles can add or update records.
          </Banner>
        </div>
      ) : null}

      <div style={cardGridStyle}>
        {MASTER_CARDS.map((card) => (
          <Link key={card.title} href={card.href} style={cardStyle} className="master-card">
            <div style={{ fontSize: 30 }}>{card.icon}</div>
            <div>
              <h2 style={{ margin: "12px 0 6px", fontSize: 18 }}>{card.title}</h2>
              <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.5 }}>{card.description}</p>
            </div>
          </Link>
        ))}
      </div>
      <style jsx>{`
        .master-card {
          transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
        }
        .master-card:hover {
          transform: translateY(-2px);
          border-color: #c7d2fe;
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
        }
      `}</style>
    </div>
  );
}

function Banner({ children }) {
  return (
    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 10, padding: 12 }}>
      {children}
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
  flexWrap: "wrap",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
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

const eyebrowStyle = {
  textTransform: "uppercase",
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

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 18,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  textDecoration: "none",
  color: "inherit",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
