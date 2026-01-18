import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function FinanceHomePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Finance…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Finance"
            description="Review spend and company totals."
            rightActions={
              <button type="button" onClick={handleSignOut} style={dangerButtonStyle}>
                Sign Out
              </button>
            }
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Finance & Expenses"
          description="Track spend, categories, and simple month totals."
          rightActions={
            <>
              <Link href="/erp" style={linkButtonStyle}>
                Back to ERP Home
              </Link>
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            </>
          }
        />

        <p style={{ margin: 0, color: "#4b5563" }}>
          Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || "member"}</strong>
        </p>

        <section style={cardGridStyle}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} style={{ ...cardStyle, ...cardLinkStyle }}>
              <div style={cardIconStyle}>{item.icon}</div>
              <div>
                <h2 style={cardTitleStyle}>{item.title}</h2>
                <p style={cardDescriptionStyle}>{item.description}</p>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </ErpShell>
  );
}

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const cardLinkStyle = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  textAlign: "left",
  textDecoration: "none",
  color: "#111827",
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

const dangerButtonStyle = {
  ...secondaryButtonStyle,
  borderColor: "#dc2626",
  color: "#dc2626",
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const navItems = [
  {
    title: "Expenses",
    description: "Record expenses, categories, and monthly totals.",
    href: "/erp/finance/expenses",
    icon: "🧾",
  },
  {
    title: "Finance Bridge",
    description: "Inventory + GRN exports ready for CA/GST review.",
    href: "/erp/finance/bridge",
    icon: "🧩",
  },
  {
    title: "Marketplace Margin",
    description: "Upload settlement files and analyze SKU/order profitability.",
    href: "/erp/finance/marketplace-margin",
    icon: "📊",
  },
];
