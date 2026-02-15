import { eyebrowStyle, h1Style, pageContainerStyle, pageHeaderStyle, subtitleStyle } from "../../../../../components/erp/uiStyles";

export default function FlipkartOmsOrdersPlaceholder() {
  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Flipkart</p>
            <h1 style={h1Style}>Orders</h1>
            <p style={subtitleStyle}>Flipkart OMS orders will be available here soon.</p>
          </div>
        </header>
      </div>
    </>
  );
}
