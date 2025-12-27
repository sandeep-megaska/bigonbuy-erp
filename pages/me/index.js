import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";
import { getEmployeeContext, requireAuthRedirectHome } from "../../lib/erpContext";

export default function EmployeeHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getEmployeeContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId || !context.employeeId) {
        setError("Your account is not linked to an employee record. Contact HR.");
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
    return <div style={containerStyle}>Loading ESS…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Employee Self-Service</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load employee context."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Employee</p>
          <h1 style={titleStyle}>Self-Service Portal</h1>
          <p style={subtitleStyle}>View your profile, leave, and payslips.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <Link href="/" style={{ color: "#2563eb", textDecoration: "none" }}>
            ← Back to Console
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
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
  backgroundColor: "#111827",
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

const navItems = [
  {
    title: "Profile",
    description: "View your employee information.",
    href: "/me/profile",
    icon: "🧑‍💼",
  },
  {
    title: "Leave",
    description: "View balances and request leave.",
    href: "/me/leave",
    icon: "🌴",
  },
  {
    title: "Payslips",
    description: "See payroll items for you.",
    href: "/me/payslips",
    icon: "💰",
  },
];
