import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const emptyForm = {
  code: "",
  name: "",
  timezone: "",
  is_default: false,
};

type ToastState = { type: "success" | "error"; message: string } | null;

type FormState = typeof emptyForm;

type DefaultConflictState = {
  message: string;
  active: boolean;
};

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
  const [defaultConflict, setDefaultConflict] = useState<DefaultConflictState>({
    message: "",
    active: false,
  });

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

  async function saveCalendar(options?: { unsetDefault?: boolean }) {
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
    setDefaultConflict({ message: "", active: false });

    if (options?.unsetDefault) {
      const { error: unsetError } = await supabase
        .from("erp_calendars")
        .update({ is_default: false })
        .eq("is_default", true);
      if (unsetError) {
        setFormError(unsetError.message || "Unable to clear existing default calendar.");
        setSaving(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from("erp_calendars")
      .insert({
        code: form.code.trim(),
        name: form.name.trim(),
        timezone: form.timezone.trim() || null,
        is_default: form.is_default,
      })
      .select("id")
      .single();

    if (error) {
      const message = error.message || "Unable to create calendar.";
      if (error.code === "23505" && form.is_default) {
        setDefaultConflict({
          message:
            "Another calendar is already marked as default. You can unset the existing default and retry.",
          active: true,
        });
        setSaving(false);
        return;
      }
      if (error.code === "23505" && message.includes("erp_calendars_company_code_key")) {
        setFormError("Calendar code must be unique.");
      } else {
        setFormError(message);
      }
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Calendar created successfully." });
    setSaving(false);
    if (data?.id) {
      router.push(`/erp/hr/calendars/${data.id}`);
    } else {
      router.push("/erp/hr/calendars");
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    await saveCalendar();
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
        <h1 style={{ marginTop: 0 }}>Create Calendar</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Calendars</p>
        <h1 style={titleStyle}>Create Calendar</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Calendars</p>
          <h1 style={titleStyle}>New Attendance Calendar</h1>
          <p style={subtitleStyle}>Create a new calendar and optionally mark it as default.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr/calendars" style={linkStyle}>
            ← Back to Calendars
          </Link>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <form onSubmit={handleSave} style={formGridStyle}>
          <label style={labelStyle}>
            Code *
            <input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="e.g., IND-STD"
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            Name *
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., India Standard Calendar"
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            Timezone
            <input
              value={form.timezone}
              onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
              placeholder="e.g., Asia/Kolkata"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Default Calendar
            <div style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))}
              />
              <span style={{ color: "#4b5563" }}>Mark as default for the company</span>
            </div>
          </label>

          {defaultConflict.active ? (
            <div style={warningBoxStyle}>
              <p style={{ margin: 0 }}>{defaultConflict.message}</p>
              <button
                type="button"
                onClick={() => saveCalendar({ unsetDefault: true })}
                style={secondaryButtonStyle}
                disabled={saving}
              >
                Unset existing default and retry
              </button>
            </div>
          ) : null}

          {formError ? <div style={errorBoxStyle}>{formError}</div> : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <Link href="/erp/hr/calendars" style={buttonStyleLink}>
              Cancel
            </Link>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? "Saving..." : "Save Calendar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-start",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 20,
  marginBottom: 20,
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "6px 0 8px", fontSize: 30, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  fontSize: 14,
  color: "#374151",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const buttonStyleLink: CSSProperties = {
  padding: "10px 16px",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 6,
  textDecoration: "none",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const secondaryButtonStyle: CSSProperties = {
  marginTop: 12,
  padding: "8px 12px",
  border: "1px solid #f59e0b",
  backgroundColor: "#fff7ed",
  color: "#b45309",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const successBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#ecfdf3",
  color: "#166534",
  border: "1px solid #bbf7d0",
  marginBottom: 16,
};

const errorBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  marginBottom: 16,
};

const warningBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#fffbeb",
  color: "#b45309",
  border: "1px solid #fde68a",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
