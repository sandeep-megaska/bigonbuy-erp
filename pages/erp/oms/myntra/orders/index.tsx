import ErpShell from "../../../../../components/erp/ErpShell";
import { eyebrowStyle, h1Style, pageContainerStyle, pageHeaderStyle, subtitleStyle } from "../../../../../components/erp/uiStyles";

export default function MyntraOmsOrdersPlaceholder() {
  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Myntra</p>
            <h1 style={h1Style}>Orders</h1>
            <p style={subtitleStyle}>Myntra OMS orders will be available here soon.</p>
          </div>
        </header>
      </div>
    </ErpShell>
  );
}
