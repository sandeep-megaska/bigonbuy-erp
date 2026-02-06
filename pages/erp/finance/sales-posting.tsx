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

const postingLinks = [
  {
    title: "Shopify Sales Posting",
    description: "Review Shopify order posting coverage and post missing journals.",
    href: "/erp/finance/sales/shopify",
  },
  {
    title: "Amazon Settlement Posting",
    description: "Review Amazon settlement posting coverage and post finance journals.",
    href: "/erp/finance/amazon/settlement-posting",
  },
  {
    title: "Marketplace Sales Posting (Other)",
    description: "Coming soon",
    href: "",
    disabled: true,
  },
  {
    title: "Sales Invoices",
    description: "Open invoices separately from channel posting workflows.",
    href: "/erp/finance/invoices",
  },
] as const;

export default function FinanceSalesPostingHubPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
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
        <div style={pageContainerStyle}>Loading Sales Posting…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Sales Posting"
            description="Open channel-specific sales posting workflows."
            rightActions={
              <button type="button" onClick={handleSignOut} style={dangerButtonStyle}>
                Sign Out
              </button>
            }
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>You are signed in but no company is linked to your account.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Sales Posting"
          description="Choose a channel workflow for sales posting and settlement entries."
          rightActions={
            <>
              <Link href="/erp/finance" style={linkButtonStyle}>
                Back to Finance
              </Link>
              <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>
                Sign Out
              </button>
            </>
          }
        />

        <section style={gridStyle}>
          {postingLinks.map((item) => {
            if (item.disabled) {
              return (
                <article key={item.title} style={{ ...cardStyle, ...disabledCardStyle }}>
                  <h2 style={cardTitleStyle}>{item.title}</h2>
                  <p style={cardDescriptionStyle}>{item.description}</p>
                </article>
              );
            }

            return (
              <Link key={item.href} href={item.href} style={{ ...cardStyle, ...cardLinkStyle }}>
                <h2 style={cardTitleStyle}>{item.title}</h2>
                <p style={cardDescriptionStyle}>{item.description}</p>
              </Link>
            );
          })}
        </section>
      </div>
    </ErpShell>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 16,
};

const cardLinkStyle = {
  textDecoration: "none",
  color: "#111827",
};

const disabledCardStyle = {
  opacity: 0.7,
  borderStyle: "dashed",
};

const cardTitleStyle = {
  margin: "0 0 8px",
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
