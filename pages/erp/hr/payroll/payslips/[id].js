import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import PayslipDetail from "../../../../../components/erp/payroll/PayslipDetail";
import { supabase } from "../../../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../../lib/erpContext";

export default function HrPayslipDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  const canManage = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

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
    if (!ctx?.companyId || !router.isReady || !id) return;
    let active = true;
    (async () => {
      setDataLoading(true);
      setErr("");
      const { data, error } = await supabase.rpc("erp_payslip_get", {
        p_payslip_id: id,
      });
      if (!active) return;
      if (error) {
        setErr(error.message || "Unable to load payslip.");
        setDataLoading(false);
        return;
      }
      setPayload(data || null);
      setDataLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ctx, router.isReady, id]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  async function handleDownload() {
    if (!ctx?.session?.access_token || !id) return;
    try {
      const response = await fetch(`/api/erp/payslips/${id}/pdf`, {
        headers: { Authorization: `Bearer ${ctx.session.access_token}` },
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to download PDF");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Payslip-${payload?.payslip?.payslip_no || id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message || "Failed to download PDF");
    }
  }

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

  if (!payload?.payslip) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payslip</h1>
        <p style={{ color: "#b91c1c" }}>{err || "Payslip not found."}</p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/erp/hr/payroll/runs" style={buttonStyle}>Back to Payroll</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <PayslipDetail
      payslip={payload.payslip}
      earnings={payload.earnings || []}
      deductions={payload.deductions || []}
      backHref={`/erp/hr/payroll/runs/${payload.payslip.payroll_run_id}`}
      backLabel="Back to Payroll Run"
      onDownload={handleDownload}
      contextLabel={`Signed in as ${ctx?.email} · Role: ${ctx?.roleKey}${canManage ? " (HR access)" : ""}`}
    />
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
