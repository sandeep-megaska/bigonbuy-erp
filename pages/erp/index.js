import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import ErpNavBar from "../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../lib/erpContext";
import { ERP_NAV, getCurrentErpAccess, isNavItemAllowed } from "../../lib/erp/nav";
import { supabase } from "../../lib/supabaseClient";

export default function ErpHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });

  const navItemsBySection = useMemo(() => {
    const allowedItems = ERP_NAV.filter((item) => isNavItemAllowed(item, access)).filter(
      (item) => item.id !== "erp-home" && item.description
    );

    return allowedItems.reduce((acc, item) => {
      acc[item.section] = acc[item.section] || [];
      acc[item.section].push(item);
      return acc;
    }, {});
  }, [access]);

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
    return <div style={containerStyle}>Loading account...</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>ERP Home</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <p style={{ color: "#374151", marginTop: 8 }}>Account not linked to company. Please ask admin to invite you.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>ERP Home</p>
          <h1 style={titleStyle}>Welcome to Bigonbuy ERP</h1>
          <p style={subtitleStyle}>Manage your catalog, variants, and inventory from a single place.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, color: "#374151" }}>
            Signed in as <strong>{ctx.email}</strong>
          </p>
          <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
            Role: <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
          <button type="button" onClick={handleSignOut} style={{ ...buttonStyle, marginTop: 8 }}>
            Sign Out
          </button>
        </div>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {Object.entries(navItemsBySection).map(([section, items]) => (
          <div key={section} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <p style={sectionLabelStyle}>{section}</p>
              <div style={sectionDividerStyle} />
            </div>
            <div style={cardGridStyle}>
              {items.map((item) => (
                <Link key={item.href} href={item.href} style={cardStyle}>
                  <div style={cardIconStyle}>{item.label.slice(0, 2)}</div>
                  <div style={{ flex: 1 }}>
                    <h2 style={cardTitleStyle}>{item.label}</h2>
                    <p style={cardDescriptionStyle}>{item.description}</p>
                    <div style={{ marginTop: 10 }}>
                      <span style={cardCtaStyle}>Open →</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
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
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
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
const sectionLabelStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const sectionDividerStyle = {
  flex: 1,
  height: 1,
  background: "#e5e7eb",
};
