import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../lib/erpContext";

export default function ErpHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

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
    return <div style={containerStyle}>Loading account...</div>;
  }

  if (!ctx?.companyId) {
    const handleBootstrap = async () => {
      setBootstrapError("");
      setBootstrapBusy(true);
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (sessionError || !accessToken) {
          setBootstrapError("Please log in again");
          return;
        }

        const res = await fetch("/api/company/bootstrap-owner", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

        const body = await res.json();
        if (!res.ok || !body.ok) {
          throw new Error(body.error || "Failed to bootstrap owner");
        }

        router.reload();
      } catch (e) {
        setBootstrapError(e?.message || "Failed to bootstrap owner");
      } finally {
        setBootstrapBusy(false);
      }
    };

    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>ERP Home</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        <p style={{ color: "#555" }}>You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={handleBootstrap} style={{ ...buttonStyle, backgroundColor: "#16a34a" }} disabled={bootstrapBusy}>
            {bootstrapBusy ? "Bootstrapping..." : "Become Owner (Bootstrap)"}
          </button>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
        {bootstrapError ? <p style={{ color: "#b91c1c", marginTop: 10 }}>{bootstrapError}</p> : null}
      </div>
    );
  }

  return (
    <div style={containerStyle}>
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
          <p style={{ margin: "4px 0 0", color: "#4b5563" }}>Role: <strong>{ctx.roleKey || "member"}</strong></p>
          <button type="button" onClick={handleSignOut} style={{ ...buttonStyle, marginTop: 8 }}>
            Sign Out
          </button>
        </div>
      </header>

      <section style={cardGridStyle}>
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} style={cardStyle}>
            <div style={cardIconStyle}>{item.icon}</div>
            <div>
              <h2 style={cardTitleStyle}>{item.title}</h2>
              <p style={cardDescriptionStyle}>{item.description}</p>
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

const navItems = [
  {
    title: "Products",
    description: "Create and manage your product catalog.",
    href: "/erp/products",
    icon: "📦",
  },
  {
    title: "Variants",
    description: "Organize options and product variations.",
    href: "/erp/variants",
    icon: "🧩",
  },
  {
    title: "Inventory",
    description: "Track stock levels across variants.",
    href: "/erp/inventory",
    icon: "📊",
  },
  {
    title: "Human Resources",
    description: "Employees, salary, leave, and payroll.",
    href: "/erp/hr",
    icon: "🧑‍💼",
  },
  {
    title: "Finance",
    description: "Track expenses, categories, and spend totals.",
    href: "/erp/finance",
    icon: "💵",
  },
];
