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

type ActionState = "reset" | null;

type ApiResponse =
  | { ok: true; portal: PortalAccessStatus }
  | { ok: false; error: string };

type ActionResponse =
  | { ok: true; portal: PortalAccessStatus; temp_password: string }
  | { ok: false; error: string };

export default function PortalAccessTab({ employeeId, accessToken, canManage }: Props) {
  const [portal, setPortal] = useState<PortalAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<ActionState>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

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

  async function handleResetPassword() {
    if (!canManage) return;
    setSaving("reset");
    setError("");
    setToast(null);

    try {
      const res = await fetch(`/api/erp/hr/employees/${employeeId}/portal-reset-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = (await res.json()) as ActionResponse;
      if (!res.ok || !data.ok) {
        setError(!data.ok ? data.error : "Failed to reset portal password.");
        return;
      }
      setPortal(data.portal);
      setTempPassword(data.temp_password);
      setToast({ type: "success", message: "Temporary password generated." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset portal password.";
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
            onClick={handleResetPassword}
            style={primaryButtonStyle}
            disabled={!canManage || saving !== null}
          >
            {saving === "reset" ? "Saving…" : isActive ? "Reset Password" : "Enable Portal Access"}
          </button>
        </div>
      </div>
      {tempPassword ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Temporary password</div>
            <p style={{ marginTop: 0, color: "#4b5563" }}>
              This password will not be shown again. Ask the employee to change it after login.
            </p>
            <div style={passwordBoxStyle}>{tempPassword}</div>
            <div style={modalActionRowStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(tempPassword);
                    setToast({ type: "success", message: "Password copied to clipboard." });
                  } catch (err) {
                    const message = err instanceof Error ? err.message : "Unable to copy password.";
                    setToast({ type: "error", message });
                  }
                }}
              >
                Copy password
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => setTempPassword(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: 20,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
};

const passwordBoxStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "0.08em",
  padding: "12px 14px",
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  marginBottom: 16,
  textAlign: "center",
};

const modalActionRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  flexWrap: "wrap",
};

const secondaryButtonStyle: CSSProperties = {
  background: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 600,
};
