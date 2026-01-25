import { useMemo, useRef, useState } from "react";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";

const MAX_RANGE_DAYS = 60;

type CashflowTotals = {
  grossSales: number;
  refunds: number;
  netSales: number;
  amazonCharges: number;
  netCashflow: number;
};

type BreakdownEntry = {
  key: string;
  amount: number;
  count: number;
};

type CashflowResponse = {
  range: { start: string; end: string };
  partialTotals: Record<string, CashflowTotals>;
  breakdown: {
    revenue: BreakdownEntry[];
    refunds: BreakdownEntry[];
    charges: BreakdownEntry[];
  };
  nextToken?: string;
  debug: {
    eventGroupsCount: number;
    pagesFetchedThisCall: number;
    eventsCountThisCall: number;
    warnings: string[];
  };
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const inlineFieldStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "flex-end",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#4b5563",
};

const warningStyle: React.CSSProperties = {
  margin: 0,
  color: "#b45309",
  fontSize: 13,
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: 13,
};

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);
  } catch (error) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function getRangeDiffDays(start: string, end: string): number | null {
  if (!start || !end) return null;
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export default function AmazonOmsOrdersPlaceholder() {
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cashflow, setCashflow] = useState<{
    range: { start: string; end: string };
    totalsByCurrency: Record<string, CashflowTotals>;
    breakdown: {
      revenue: BreakdownEntry[];
      refunds: BreakdownEntry[];
      charges: BreakdownEntry[];
    };
    debug: {
      warnings: string[];
      pagesFetched: number;
      eventsFetched: number;
    };
  } | null>(null);
  const [isStopped, setIsStopped] = useState(false);
  const stopRef = useRef(false);

  const breakdownCurrency = useMemo(() => {
    if (!cashflow) return "INR";
    const currencies = Object.keys(cashflow.totalsByCurrency);
    return currencies.length === 1 ? currencies[0] : "INR";
  }, [cashflow]);

  const rangeSummary = useMemo(() => {
    const diff = getRangeDiffDays(startDate, endDate);
    if (!diff || diff <= 0) return null;
    return `${diff} day${diff === 1 ? "" : "s"} selected`;
  }, [startDate, endDate]);

  const validateRange = (): boolean => {
    const diff = getRangeDiffDays(startDate, endDate);
    if (!startDate || !endDate) {
      setRangeError("Select a start and end date.");
      return false;
    }
    if (!diff || diff <= 0) {
      setRangeError("End date must be on or after start date.");
      return false;
    }
    if (diff > MAX_RANGE_DAYS) {
      setRangeError(`Date range must be ${MAX_RANGE_DAYS} days or less.`);
      return false;
    }
    setRangeError(null);
    return true;
  };

  const mergeTotals = (
    existing: Record<string, CashflowTotals>,
    incoming: Record<string, CashflowTotals>
  ): Record<string, CashflowTotals> => {
    const merged = { ...existing };
    Object.entries(incoming).forEach(([currency, totals]) => {
      const current = merged[currency] ?? {
        grossSales: 0,
        refunds: 0,
        netSales: 0,
        amazonCharges: 0,
        netCashflow: 0,
      };
      merged[currency] = {
        grossSales: current.grossSales + totals.grossSales,
        refunds: current.refunds + totals.refunds,
        netSales: current.netSales + totals.netSales,
        amazonCharges: current.amazonCharges + totals.amazonCharges,
        netCashflow: current.netCashflow + totals.netCashflow,
      };
    });
    return merged;
  };

  const mergeBreakdown = (existing: BreakdownEntry[], incoming: BreakdownEntry[]): BreakdownEntry[] => {
    const map = new Map<string, BreakdownEntry>();
    existing.forEach((entry) => {
      map.set(entry.key, { ...entry });
    });
    incoming.forEach((entry) => {
      const current = map.get(entry.key);
      if (current) {
        current.amount += entry.amount;
        current.count += entry.count;
      } else {
        map.set(entry.key, { ...entry });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  };

  const handleFetch = async () => {
    setApiError(null);
    if (!validateRange()) return;
    setIsStopped(false);
    stopRef.current = false;
    setIsLoading(true);
    setCashflow({
      range: { start: startDate, end: endDate },
      totalsByCurrency: {},
      breakdown: { revenue: [], refunds: [], charges: [] },
      debug: { warnings: [], pagesFetched: 0, eventsFetched: 0 },
    });
    try {
      let nextToken: string | undefined;
      do {
        if (stopRef.current) break;
        const params = new URLSearchParams({ start: startDate, end: endDate });
        if (nextToken) params.set("nextToken", nextToken);
        const res = await fetch(`/api/oms/amazon/cashflow?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          const errorMessage = typeof json?.error === "string" ? json.error : "Unable to fetch cashflow.";
          throw new Error(errorMessage);
        }

        const data = json as CashflowResponse;
        nextToken = data.nextToken;
        setCashflow((prev) => {
          if (!prev) {
            return {
              range: data.range,
              totalsByCurrency: data.partialTotals,
              breakdown: data.breakdown,
              debug: {
                warnings: data.debug.warnings,
                pagesFetched: data.debug.pagesFetchedThisCall,
                eventsFetched: data.debug.eventsCountThisCall,
              },
            };
          }
          return {
            range: data.range,
            totalsByCurrency: mergeTotals(prev.totalsByCurrency, data.partialTotals),
            breakdown: {
              revenue: mergeBreakdown(prev.breakdown.revenue, data.breakdown.revenue),
              refunds: mergeBreakdown(prev.breakdown.refunds, data.breakdown.refunds),
              charges: mergeBreakdown(prev.breakdown.charges, data.breakdown.charges),
            },
            debug: {
              warnings: [...prev.debug.warnings, ...data.debug.warnings],
              pagesFetched: prev.debug.pagesFetched + data.debug.pagesFetchedThisCall,
              eventsFetched: prev.debug.eventsFetched + data.debug.eventsCountThisCall,
            },
          };
        });
      } while (nextToken);
    } catch (error) {
      setApiError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Amazon</p>
            <h1 style={h1Style}>Orders</h1>
            <p style={subtitleStyle}>Track Amazon OMS orders and cashflow insights for India.</p>
          </div>
        </header>
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h2 style={h2Style}>Amazon Cashflow Summary (India)</h2>
              <p style={subtitleStyle}>Pull financial events from Amazon SP-API for a date range (max 60 days).</p>
            </div>
            {rangeSummary ? <span style={badgeStyle}>{rangeSummary}</span> : null}
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <div style={inlineFieldStyle}>
              <label style={labelStyle}>
                Start date
                <input type="date" style={inputStyle} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label style={labelStyle}>
                End date
                <input type="date" style={inputStyle} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <button style={primaryButtonStyle} onClick={handleFetch} disabled={isLoading}>
                {isLoading ? "Fetching..." : "Fetch Cashflow"}
              </button>
              {isLoading ? (
                <button
                  style={{ ...primaryButtonStyle, backgroundColor: "#9ca3af" }}
                  onClick={() => {
                    stopRef.current = true;
                    setIsStopped(true);
                  }}
                >
                  Stop
                </button>
              ) : null}
            </div>
            {rangeError ? <p style={errorStyle}>{rangeError}</p> : null}
            {apiError ? <p style={errorStyle}>{apiError}</p> : null}
            {cashflow ? (
              <p style={warningStyle}>
                Pages fetched: {cashflow.debug.pagesFetched} · Events fetched: {cashflow.debug.eventsFetched}
                {isStopped ? " · Stopped" : ""}
              </p>
            ) : null}
          </div>
        </section>

        {cashflow ? (
          <section style={{ display: "grid", gap: 20 }}>
            {Object.entries(cashflow.totalsByCurrency).map(([currency, totals]) => (
              <div key={currency} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <h2 style={h2Style}>Totals ({currency})</h2>
                  <span style={badgeStyle}>{currency}</span>
                </div>
                <div style={gridStyle}>
                  <div>
                    <p style={eyebrowStyle}>Gross Sales</p>
                    <h2 style={h2Style}>{formatCurrency(totals.grossSales, currency)}</h2>
                  </div>
                  <div>
                    <p style={eyebrowStyle}>Refunds / Returns</p>
                    <h2 style={h2Style}>{formatCurrency(totals.refunds, currency)}</h2>
                  </div>
                  <div>
                    <p style={eyebrowStyle}>Net Sales</p>
                    <h2 style={h2Style}>{formatCurrency(totals.netSales, currency)}</h2>
                  </div>
                  <div>
                    <p style={eyebrowStyle}>Amazon Charges</p>
                    <h2 style={h2Style}>{formatCurrency(totals.amazonCharges, currency)}</h2>
                  </div>
                  <div>
                    <p style={eyebrowStyle}>Net Cashflow</p>
                    <h2 style={h2Style}>{formatCurrency(totals.netCashflow, currency)}</h2>
                  </div>
                </div>
              </div>
            ))}
            {cashflow.debug.warnings.length > 0 ? (
              <section style={cardStyle}>
                <h2 style={h2Style}>Warnings</h2>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#92400e", fontSize: 13 }}>
                  {cashflow.debug.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section style={{ display: "grid", gap: 16 }}>
              <div>
                <h2 style={h2Style}>Revenue Breakdown</h2>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Type + Description</th>
                      <th style={tableHeaderCellStyle}>Count</th>
                      <th style={tableHeaderCellStyle}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.breakdown.revenue.map((row) => (
                      <tr key={row.key}>
                        <td style={tableCellStyle}>{row.key}</td>
                        <td style={tableCellStyle}>{row.count}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.amount, breakdownCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h2 style={h2Style}>Refund Breakdown</h2>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Type + Description</th>
                      <th style={tableHeaderCellStyle}>Count</th>
                      <th style={tableHeaderCellStyle}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.breakdown.refunds.map((row) => (
                      <tr key={row.key}>
                        <td style={tableCellStyle}>{row.key}</td>
                        <td style={tableCellStyle}>{row.count}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.amount, breakdownCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h2 style={h2Style}>Charges Breakdown</h2>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Type + Description</th>
                      <th style={tableHeaderCellStyle}>Count</th>
                      <th style={tableHeaderCellStyle}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.breakdown.charges.map((row) => (
                      <tr key={row.key}>
                        <td style={tableCellStyle}>{row.key}</td>
                        <td style={tableCellStyle}>{row.count}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.amount, breakdownCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <p style={warningStyle}>All values reflect Amazon financial events. SKU/ASIN and COGS are out of scope.</p>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}
