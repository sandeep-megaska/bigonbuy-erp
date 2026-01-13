import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../../lib/erpContext";

export default function PayslipViewPage() {
  const router = useRouter();
  const { runId, employeeId } = router.query;
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [err, setErr] = useState("");

  const [company, setCompany] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [run, setRun] = useState(null);
  const [item, setItem] = useState(null);

  const canWrite = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !router.isReady || !runId || !employeeId) return;
    let active = true;
    (async () => {
      setDataLoading(true);
      setErr("");
      const companyId = ctx.companyId;
      const [{ data: runData, error: runErr }, { data: empData, error: empErr }, { data: itemData, error: itemErr }, { data: companyData, error: companyErr }] =
        await Promise.all([
          supabase
            .from("erp_payroll_runs")
            .select("id, year, month, status, finalized_at")
            .eq("company_id", companyId)
            .eq("id", runId)
            .maybeSingle(),
          supabase
            .from("erp_employees")
            .select("id, full_name, employee_no")
            .eq("company_id", companyId)
            .eq("id", employeeId)
            .maybeSingle(),
          supabase
            .from("erp_payroll_items")
            .select("id, gross, deductions, net_pay, notes, payslip_no, basic, hra, allowances")
            .eq("company_id", companyId)
            .eq("payroll_run_id", runId)
            .eq("employee_id", employeeId)
            .maybeSingle(),
          supabase.from("erp_companies").select("id, name").eq("id", companyId).maybeSingle(),
        ]);

      if (!active) return;

      if (runErr || empErr || itemErr || companyErr) {
        setErr(runErr?.message || empErr?.message || itemErr?.message || companyErr?.message || "Unable to load payslip.");
        setDataLoading(false);
        return;
      }

      setRun(runData);
      setEmployee(empData);
      setItem(itemData);
      setCompany(companyData);
      setDataLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ctx, router.isReady, runId, employeeId]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  const netPay = item?.net_pay ?? ((item?.gross || 0) - (item?.deductions || 0));
  const paddedMonth = run ? String(run.month).padStart(2, "0") : null;
  const finalizedLabel = run?.status === "finalized" ? "Finalized" : run?.status;

  if (loading || dataLoading) return <div style={{ padding: 24 }}>Loading payslip…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payslip</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!run || !employee || !item) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payslip</h1>
        <p style={{ color: "#b91c1c" }}>{err || "Payslip not found for this payroll run and employee."}</p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/erp/hr/payroll/runs" style={buttonStyle}>Back to Payroll</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Payslip</h1>
          <p style={{ margin: "6px 0", color: "#555" }}>
            {company?.name || "Company"} · {run?.year}-{paddedMonth} · {finalizedLabel}
          </p>
          <p style={{ margin: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b> {canWrite ? "(HR/admin access)" : "(read-only)"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr/payroll/runs" style={buttonStyle}>← Back to Payroll</a>
          <button onClick={() => window.print()} style={{ ...buttonStyle, background: "#111", color: "#fff", borderColor: "#111" }}>
            Print
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, color: "#555" }}>Company</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{company?.name || "—"}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>Period</div>
            <div style={{ fontSize: 16 }}>{run.year}-{paddedMonth}</div>
            {item.payslip_no ? (
              <>
                <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>Payslip #</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{item.payslip_no}</div>
              </>
            ) : null}
          </div>
          <div style={{ minWidth: 280 }}>
            <div style={{ fontSize: 13, color: "#555" }}>Employee</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{employee.full_name}</div>
            <div style={{ fontSize: 13, color: "#777" }}>{employee.employee_no || employee.id}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>Payroll Run</div>
            <div style={{ fontSize: 16 }}>{run.status} · {run.id}</div>
          </div>
        </div>

        <div style={{ marginTop: 20, border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div style={sectionCellStyle}>
              <div style={sectionTitleStyle}>Earnings</div>
              <div style={rowStyle}>
                <span>Basic</span>
                <span>{item.basic ?? "—"}</span>
              </div>
              <div style={rowStyle}>
                <span>HRA</span>
                <span>{item.hra ?? "—"}</span>
              </div>
              <div style={rowStyle}>
                <span>Allowances</span>
                <span>{item.allowances ?? "—"}</span>
              </div>
              <div style={{ ...rowStyle, fontWeight: 700 }}>
                <span>Gross</span>
                <span>{item.gross ?? "—"}</span>
              </div>
            </div>
            <div style={sectionCellStyle}>
              <div style={sectionTitleStyle}>Deductions & Net</div>
              <div style={rowStyle}>
                <span>Deductions</span>
                <span>{item.deductions ?? 0}</span>
              </div>
              <div style={{ ...rowStyle, fontWeight: 700, borderTop: "1px dashed #e5e5e5", paddingTop: 12 }}>
                <span>Net Pay</span>
                <span>{netPay}</span>
              </div>
            </div>
          </div>
        </div>

        {item.notes ? (
          <div style={{ marginTop: 14, padding: 12, border: "1px dashed #e5e5e5", borderRadius: 8, background: "#fafafa" }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Notes</div>
            <div>{item.notes}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer", textDecoration: "none", background: "#fff", color: "#111" };
const sectionCellStyle = { padding: 16, borderRight: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", minHeight: 140 };
const sectionTitleStyle = { fontSize: 13, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 };
const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", fontSize: 15 };
