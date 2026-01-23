import Link from "next/link";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, secondaryButtonStyle, subtitleStyle } from "../../../../../components/erp/uiStyles";

export default function ApPaymentsPage() {
  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="AP Payments"
          description="Track vendor payments and reconcile outgoing cash."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        <section style={cardStyle}>
          <p style={subtitleStyle}>AP payment workflows will appear here soon.</p>
        </section>
      </div>
    </ErpShell>
  );
}
