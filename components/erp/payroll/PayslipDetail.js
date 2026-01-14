export default function PayslipDetail({
  payslip,
  earnings,
  deductions,
  backHref,
  backLabel,
  onDownload,
  contextLabel,
}) {
  const periodLabel = payslip
    ? `${payslip.period_year}-${String(payslip.period_month).padStart(2, "0")}`
    : "";
  const companyName = "Bigonbuy Trading Pvt Ltd";

  const formatAmount = (value) => {
    if (value === null || value === undefined) return "—";
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
  };

  const earningsRows = [
    { label: "Basic", value: payslip?.basic },
    { label: "HRA", value: payslip?.hra },
    { label: "Allowances", value: payslip?.allowances },
  ].filter((row) => row.value !== null && row.value !== undefined);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Payslip</h1>
          <p style={{ margin: "6px 0", color: "#555" }}>
            {companyName} · {periodLabel} · {payslip?.status || "finalized"}
          </p>
          {contextLabel ? (
            <p style={{ margin: 0, color: "#777", fontSize: 13 }}>{contextLabel}</p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {backHref ? (
            <a href={backHref} style={buttonStyle}>← {backLabel || "Back"}</a>
          ) : null}
          {onDownload ? (
            <button
              onClick={onDownload}
              style={{ ...buttonStyle, background: "#111", color: "#fff", borderColor: "#111" }}
            >
              Download PDF
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, color: "#555" }}>Company</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{companyName}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>Period</div>
            <div style={{ fontSize: 16 }}>{periodLabel}</div>
            {payslip?.payslip_no ? (
              <>
                <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>Payslip #</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{payslip.payslip_no}</div>
              </>
            ) : null}
          </div>
          <div style={{ minWidth: 280 }}>
            <div style={{ fontSize: 13, color: "#555" }}>Employee</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{payslip?.employee_name || "—"}</div>
            <div style={{ fontSize: 13, color: "#777" }}>{payslip?.employee_code || payslip?.employee_id || "—"}</div>
            {payslip?.designation ? (
              <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>{payslip.designation}</div>
            ) : null}
            {payslip?.department ? (
              <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>{payslip.department}</div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 20, border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div style={sectionCellStyle}>
              <div style={sectionTitleStyle}>Earnings</div>
              {earningsRows.map((row) => (
                <div key={row.label} style={rowStyle}>
                  <span>{row.label}</span>
                  <span>{formatAmount(row.value)}</span>
                </div>
              ))}
              {(earnings || []).map((line) => (
                <div key={line.id || line.code} style={rowStyle}>
                  <span>{line.name || line.code}</span>
                  <span>{formatAmount(line.amount)}</span>
                </div>
              ))}
              <div style={{ ...rowStyle, fontWeight: 700, borderTop: "1px dashed #e5e5e5", paddingTop: 12 }}>
                <span>Gross</span>
                <span>{formatAmount(payslip?.gross)}</span>
              </div>
            </div>
            <div style={sectionCellStyle}>
              <div style={sectionTitleStyle}>Deductions</div>
              {(deductions || []).length === 0 ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>No deductions</div>
              ) : (
                (deductions || []).map((line) => (
                  <div key={line.id || line.code} style={rowStyle}>
                    <span>{line.name || line.code}</span>
                    <span>{formatAmount(line.amount)}</span>
                  </div>
                ))
              )}
              <div style={{ ...rowStyle, fontWeight: 700, borderTop: "1px dashed #e5e5e5", paddingTop: 12 }}>
                <span>Total Deductions</span>
                <span>{formatAmount(payslip?.deductions)}</span>
              </div>
              <div style={{ ...rowStyle, fontWeight: 700 }}>
                <span>Net Pay</span>
                <span>{formatAmount(payslip?.net_pay)}</span>
              </div>
            </div>
          </div>
        </div>

        {payslip?.notes ? (
          <div style={{ marginTop: 14, padding: 12, border: "1px dashed #e5e5e5", borderRadius: 8, background: "#fafafa" }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Notes</div>
            <div>{payslip.notes}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  cursor: "pointer",
  textDecoration: "none",
  background: "#fff",
  color: "#111",
};

const sectionCellStyle = {
  padding: 16,
  display: "grid",
  gap: 10,
};

const sectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "#111",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 14,
  color: "#111",
};
