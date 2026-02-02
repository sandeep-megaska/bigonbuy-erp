import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type PortalAccessStatus = {
  employee_id: string;
  employee_code: string | null;
  is_active: boolean | null;
  must_reset_password: boolean | null;
  last_login_at: string | null;
};

type Props = {
  employeeId: string;
  accessToken: string;
  canManage: boolean;
};

type ActionState = "enable" | "reset" | "disable" | null;

type ApiResponse =
  | { ok: true; portal: PortalAccessStatus }
  | { ok: false; error: string };

type ActionResponse =
  | { ok: true; portal: PortalAccessStatus }
  | { ok: false; error: string };

export default function PortalAccessTab({ employeeId, accessToken, canManage }: Props) {
  const [portal, setPortal] = useState<PortalAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<ActionState>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasAccess = useMemo(() => Boolean(employeeId && accessToken), [employeeId, accessToken]);

  useEffect(() => {
    if (!hasAccess) return;
    void loadPortalAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, employeeId]);

  async function loadPortalAccess() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/portal-access`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) {
        setError(!data.ok ? data.error : "Failed to load portal access.");
        return;
      }
      setPortal(data.portal);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load portal access.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: "enable" | "reset" | "disable") {
    if (!canManage) return;
    setSaving(action);
    setError("");
    setToast(null);

    let tempPassword: string | null = null;
    if (action === "enable" || action === "reset") {
      tempPassword = window.prompt("Set a temporary password for the employee portal:");
      if (!tempPassword || !tempPassword.trim()) {
        setSaving(null);
        return;
      }
    }

    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/portal-access`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          temp_password: tempPassword?.trim() || undefined,
        }),
      });
      const data = (await res.json()) as ActionResponse;
      if (!res.ok || !data.ok) {
        setError(!data.ok ? data.error : "Failed to update portal access.");
        return;
      }
      setPortal(data.portal);
      setToast({
        type: "success",
        message:
          action === "disable"
            ? "Portal access disabled."
            : "Portal access updated. Temporary password set.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update portal access.";
      setError(message);
    } finally {
      setSaving(null);
    }
  }

  if (!hasAccess) {
    return <div style={{ color: "#6b7280" }}>Missing employee access context.</div>;
  }

  const isActive = Boolean(portal?.is_active);
  const lastLogin = portal?.last_login_at ? formatDateTime(portal.last_login_at) : "—";

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h3 style={{ margin: 0 }}>Portal Access</h3>
        {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}
      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {loading ? <div style={{ color: "#6b7280" }}>Loading portal access…</div> : null}

      <div style={cardStyle}>
        <div style={infoGridStyle}>
          <InfoItem label="Employee Code" value={portal?.employee_code || "—"} />
          <InfoItem label="Portal Enabled" value={portal ? (isActive ? "Yes" : "No") : "—"} />
          <InfoItem
            label="Must Reset Password"
            value={portal ? (portal.must_reset_password ? "Yes" : "No") : "—"}
          />
          <InfoItem label="Last Login" value={lastLogin} />
        </div>
        <div style={actionRowStyle}>
          <button
            type="button"
            onClick={() => handleAction(isActive ? "reset" : "enable")}
            style={primaryButtonStyle}
            disabled={!canManage || saving !== null}
          >
            {saving === "enable" || saving === "reset"
              ? "Saving…"
              : isActive
                ? "Reset Password"
                : "Enable Portal Access"}
          </button>
          <button
            type="button"
            onClick={() => handleAction("disable")}
            style={dangerButtonStyle}
            disabled={!canManage || saving !== null || !isActive}
          >
            {saving === "disable" ? "Disabling…" : "Disable Access"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={infoLabelStyle}>{label}</div>
      <div style={infoValueStyle}>{value}</div>
    </div>
  );
}

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  backgroundColor: "#fff",
};

const infoGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
  marginBottom: 16,
};

const infoLabelStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 4,
};

const infoValueStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#111827",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

const primaryButtonStyle: CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 600,
};

const dangerButtonStyle: CSSProperties = {
  background: "#fee2e2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  borderRadius: 8,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 600,
};

const successBoxStyle: CSSProperties = {
  background: "#ecfdf3",
  color: "#166534",
  border: "1px solid #bbf7d0",
  padding: "10px 12px",
  borderRadius: 8,
  marginBottom: 12,
};

const errorBoxStyle: CSSProperties = {
  background: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  padding: "10px 12px",
  borderRadius: 8,
  marginBottom: 12,
};
