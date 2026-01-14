import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type ToastState = {
  type: "success" | "error" | "warning";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
} | null;

type FormState = {
  code: string;
  name: string;
  timezone: string;
  is_default: boolean;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  timezone: "",
  is_default: false,
};

const TIMEZONE_OPTIONS = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

export default function HrCalendarCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();

    if (!canManage) {
      setFormError("Only HR/admin users can manage calendars.");
      return;
    }

    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }

    setSaving(true);
    setFormError("");
    setToast(null);

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      timezone: form.timezone.trim() || null,
      is_default: form.is_default,
    };

    const { data, error } = await supabase
      .from("erp_calendars")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (isDefaultConflict(error)) {
        setToast({
          type: "warning",
          message:
            "A default calendar already exists. You can unset the existing default and retry.",
          actionLabel: "Replace Default",
          onAction: () => handleReplaceDefault(payload),
        });
      } else if (isCodeConflict(error)) {
        setFormError("Calendar code already exists. Choose a new code.");
      } else {
        setFormError(error.message || "Unable to save calendar.");
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    if (data?.id) {
      router.push(`/erp/hr/calendars/${data.id}`);
    }
  }

  async function handleReplaceDefault(payload: {
    code: string;
    name: string;
    timezone: string | null;
    is_default: boolean;
  }) {
    if (!ctx?.companyId) return;
    setSaving(true);
    setFormError("");

    const { error: unsetError } = await supabase
      .from("erp_calendars")
      .update({ is_default: false })
      .eq("company_id", ctx.companyId)
      .eq("is_default", true);

    if (unsetError) {
      setToast({ type: "error", message: unsetError.message || "Unable to unset default calendar." });
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("erp_calendars")
      .insert({ ...payload, is_default: true })
      .select("id")
      .single();

    if (error) {
      setFormError(error.message || "Unable to save calendar after unsetting default.");
      setSaving(false);
      return;
    }

    setSaving(false);
    if (data?.id) {
      router.push(`/erp/hr/calendars/${data.id}`);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading calendar…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>New Calendar</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <ErpNavBar access={access} roleKey={ctx?.roleKey} />
        <h1 style={{ marginTop: 0 }}>New Calendar</h1>
        <p style={{ color: "#b91c1c" }}>Only HR/admin users can manage calendars.</p>
        <Link href="/erp/hr/calendars" style={linkStyle}>← Back to Calendars</Link>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={titleStyle}>Create Calendar</h1>
          <p style={subtitleStyle}>Define a new calendar and choose the default for your company.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr/calendars" style={linkStyle}>← Back to Calendars</Link>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "error" ? errorBoxStyle : warningBoxStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction ? (
              <button type="button" style={warningButtonStyle} onClick={toast.onAction}>
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {formError ? <div style={errorBoxStyle}>{formError}</div> : null}

      <form onSubmit={handleSave} style={formStyle}>
        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Code</span>
            <input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              style={inputStyle}
              placeholder="e.g., IND-STD"
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              style={inputStyle}
              placeholder="Standard India Calendar"
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Timezone</span>
            <input
              list="timezone-options"
              value={form.timezone}
              onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
              style={inputStyle}
              placeholder="Select or type a timezone"
            />
            <datalist id="timezone-options">
              {TIMEZONE_OPTIONS.map((tz) => (
                <option value={tz} key={tz} />
              ))}
            </datalist>
          </label>
          <label style={checkboxFieldStyle}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))}
            />
            <span>Set as default calendar</span>
          </label>
        </div>
        <div style={buttonRowStyle}>
          <button type="submit" style={primaryButtonStyle} disabled={saving}>
            {saving ? "Saving…" : "Save Calendar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function isDefaultConflict(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return (error.message || "").includes("erp_calendars_company_default_key");
  }
  return false;
}

function isCodeConflict(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return (error.message || "").includes("erp_calendars_company_code_key");
  }
  return false;
}

const containerStyle = {
  maxWidth: 1120,
  margin: "72px auto",
  padding: "48px 56px 56px",
  borderRadius: 12,
  border: "1px solid #e7eaf0",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
};

const formStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 18,
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 16,
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};

const checkboxFieldStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 24,
  fontSize: 14,
  color: "#111827",
};

const labelStyle = {
  fontSize: 13,
  color: "#374151",
  fontWeight: 600,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const buttonRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
};

const eyebrowStyle = {
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 34,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
  maxWidth: 560,
  lineHeight: 1.5,
};

const linkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: 14,
};

const buttonStyle = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const primaryButtonStyle = {
  backgroundColor: "#111827",
  color: "#fff",
  padding: "10px 16px",
  borderRadius: 8,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
};

const warningButtonStyle = {
  backgroundColor: "#f59e0b",
  color: "#111827",
  padding: "8px 12px",
  borderRadius: 8,
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
};

const warningBoxStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  backgroundColor: "#fffbeb",
  color: "#92400e",
  border: "1px solid #fde68a",
  marginBottom: 18,
};

const errorBoxStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  marginBottom: 18,
};
