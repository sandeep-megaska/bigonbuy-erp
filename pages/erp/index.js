import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import ErpNavBar from "../../components/erp/ErpNavBar";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../lib/erpContext";
import { getCurrentErpAccess } from "../../lib/erp/nav";
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

  const sections = useMemo(() => {
    const canAdmin = isAdmin(ctx?.roleKey || access.roleKey);
    const canManage = access.isManager;

    const baseSections = [
      {
        title: "Workspace",
        description: "Core catalog and stock workflows.",
        items: [
          {
            title: "Products",
            description: "Create and manage your product catalog.",
            href: "/erp/products",
            status: "Active",
            cta: "Manage",
          },
          {
            title: "Variants",
            description: "Organize options and product variations.",
            href: "/erp/variants",
            status: "Active",
            cta: "Review",
          },
          {
            title: "Inventory",
            description: "Track stock levels across variants.",
            href: "/erp/inventory",
            status: "Active",
            cta: "Open",
          },
        ],
      },
      {
        title: "HR",
        description: "Employees, salary, leave, and payroll operations.",
        items: [
          {
            title: "Human Resources",
            description: "Payroll, attendance, and HR masters.",
            href: "/erp/hr",
            status: "Active",
            cta: "Open",
          },
        ],
      },
      {
        title: "Finance",
        description: "Expense tracking and financial reporting.",
        items: [
          {
            title: "Finance",
            description: "Track spend, invoices, and budgets.",
            href: "/erp/finance",
            status: "Coming Soon",
            disabled: true,
          },
        ],
      },
    ];

    if (canAdmin) {
      baseSections.push({
        title: "Admin",
        description: "Company access and governance controls.",
        items: [
          {
            title: "Company Users",
            description: "Invite staff and manage access.",
            href: "/erp/admin/company-users",
            status: "Active",
            cta: "Manage",
          },
          {
            title: "Company Settings",
            description: "Configure branding and organization details.",
            href: "/erp/admin/company-settings",
            status: "Active",
            cta: "Configure",
          },
        ],
      });
    }

    if (!canManage) {
      return baseSections.filter((section) => section.title !== "HR");
    }

    return baseSections;
  }, [access.isManager, access.roleKey, ctx?.roleKey]);

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

      <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {sections.map((section) => (
          <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <p style={sectionLabelStyle}>{section.title}</p>
              <div style={sectionDividerStyle} />
            </div>
            <p style={sectionDescriptionStyle}>{section.description}</p>
            <div style={cardGridStyle}>
              {section.items.map((item) => {
                const content = (
                  <>
                    <div style={cardIconStyle}>{item.title.slice(0, 2)}</div>
                    <div style={{ flex: 1 }}>
                      <h2 style={cardTitleStyle}>{item.title}</h2>
                      <p style={cardDescriptionStyle}>{item.description}</p>
                      <div style={cardMetaStyle}>
                        <span
                          style={{
                            ...statusBadgeStyle,
                            ...(item.status === "Coming Soon" ? disabledStatusBadgeStyle : {}),
                          }}
                        >
                          {item.status}
                        </span>
                        {item.cta ? <span style={cardCtaStyle}>{item.cta} →</span> : null}
                      </div>
                    </div>
                  </>
                );

                if (item.disabled) {
                  return (
                    <div
                      key={item.title}
                      style={{ ...cardStyle, ...disabledCardStyle }}
                      className="module-card disabled"
                    >
                      {content}
                    </div>
                  );
                }

                return (
                  <Link key={item.href} href={item.href} style={cardStyle} className="module-card">
                    {content}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>
      <style jsx>{`
        .module-card {
          transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
        }
        .module-card:hover {
          transform: translateY(-2px);
          border-color: #c7d2fe;
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
        }
        .module-card.disabled {
          cursor: not-allowed;
        }
        .module-card.disabled:hover {
          transform: none;
          border-color: #e5e7eb;
          box-shadow: none;
        }
      `}</style>
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

const cardMetaStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 12,
  gap: 12,
};

const cardCtaStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "#1d4ed8",
  fontWeight: 700,
  textDecoration: "none",
  fontSize: 13,
};

const statusBadgeStyle = {
  padding: "4px 10px",
  borderRadius: 999,
  backgroundColor: "#ecfeff",
  color: "#0e7490",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const disabledStatusBadgeStyle = {
  backgroundColor: "#fef3c7",
  color: "#92400e",
};

const disabledCardStyle = {
  backgroundColor: "#f8fafc",
  color: "#9ca3af",
  borderColor: "#e5e7eb",
  boxShadow: "none",
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

const sectionDescriptionStyle = {
  margin: 0,
  color: "#6b7280",
  fontSize: 14,
};
