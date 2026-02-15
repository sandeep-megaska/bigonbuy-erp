import Link from "next/link";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle } from "../../../../components/erp/uiStyles";

type SettingsCard = {
  title: string;
  description: string;
  href?: string;
};

const cards: SettingsCard[] = [
  {
    title: "Loan Posting",
    description: "Configure accounts for loan disbursement and EMI posting.",
    href: "/erp/finance/settings/loan-posting",
  },
  { title: "Sales Posting", description: "Coming soon" },
  { title: "Expense Posting", description: "Coming soon" },
  { title: "Marketplace Posting", description: "Coming soon" },
  { title: "Bank Accounts", description: "Coming soon" },
];

export default function FinanceSettingsHubPage() {
  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Finance Settings"
          description="One-time configuration and finance controls."
        />

        <section style={gridStyle}>
          {cards.map((card) => {
            if (card.href) {
              return (
                <Link key={card.title} href={card.href} style={{ ...cardStyle, ...activeCardStyle }}>
                  <h2 style={cardTitleStyle}>{card.title}</h2>
                  <p style={cardDescriptionStyle}>{card.description}</p>
                </Link>
              );
            }

            return (
              <div key={card.title} style={{ ...cardStyle, ...disabledCardStyle }} aria-disabled>
                <h2 style={cardTitleStyle}>{card.title}</h2>
                <p style={cardDescriptionStyle}>{card.description}</p>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const activeCardStyle = {
  textDecoration: "none",
  color: "#111827",
  display: "grid",
  gap: 8,
};

const disabledCardStyle = {
  color: "#6b7280",
  opacity: 0.8,
  display: "grid",
  gap: 8,
};

const cardTitleStyle = {
  margin: 0,
  fontSize: 18,
};

const cardDescriptionStyle = {
  margin: 0,
  fontSize: 14,
};
