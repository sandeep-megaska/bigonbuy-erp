import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

type ShiftRow = {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  min_half_day_minutes: number;
  min_full_day_minutes: number;
  ot_after_minutes: number | null;
  is_night_shift: boolean;
  is_active: boolean;
  updated_at?: string;
};

type ShiftFormState = {
  id: string | null;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: string;
  grace_minutes: string;
  min_half_day_minutes: string;
  min_full_day_minutes: string;
  ot_after_minutes: string;
  is_night_shift: boolean;
  is_active: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const emptyForm: ShiftFormState = {
  id: null,
  code: "",
  name: "",
  start_time: "09:00",
  end_time: "18:00",
  break_minutes: "0",
  grace_minutes: "0",
  min_half_day_minutes: "240",
  min_full_day_minutes: "480",
  ot_after_minutes: "",
  is_night_shift: false,
  is_active: true,
};

export default function HrShiftsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [form, setForm] = useState<ShiftFormState>({ ...emptyForm });
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

      await loadShifts();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadShifts() {
    const { data, error } = await supabase
      .from("erp_hr_shifts")
      .select(
        "id, code, name, start_time, end_time, break_minutes, grace_minutes, min_half_day_minutes, min_full_day_minutes, ot_after_minutes, is_night_shift, is_active, updated_at"
      )
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load shifts." });
      return;
    }

    setShifts((data as ShiftRow[]) || []);
  }

  function resetForm() {
    setForm({ ...emptyForm });
    setFormError("");
  }

  function beginEdit(row: ShiftRow) {
    setForm({
      id: row.id,
      code: row.code || "",
      name: row.name || "",
      start_time: row.start_time || "09:00",
      end_time: row.end_time || "18:00",
      break_minutes: String(row.break_minutes ?? 0),
      grace_minutes: String(row.grace_minutes ?? 0),
      min_half_day_minutes: String(row.min_half_day_minutes ?? 240),
      min_full_day_minutes: String(row.min_full_day_minutes ?? 480),
      ot_after_minutes: row.ot_after_minutes === null ? "" : String(row.ot_after_minutes),
      is_night_shift: !!row.is_night_shift,
      is_active: !!row.is_active,
    });
    setFormError("");
  }

  function parseMinutes(value: string, fallback: number) {
    if (!value.trim()) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return parsed;
  }

  async function checkCodeUnique(code: string, currentId?: string | null) {
    const trimmed = code.trim();
    if (!trimmed) return true;
    const { data, error } = await supabase
      .from("erp_hr_shifts")
      .select("id")
      .eq("code", trimmed)
      .limit(2);

    if (error) {
      setFormError(error.message || "Unable to validate shift code.");
      return false;
    }
    if (!Array.isArray(data) || data.length === 0) return true;
    if (data.length === 1 && data[0]?.id === currentId) return true;
    setFormError("Shift code must be unique.");
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setToast(null);
    if (!canManage) {
      setFormError("Only HR/admin users can manage shifts.");
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }
    if (!form.start_time.trim() || !form.end_time.trim()) {
      setFormError("Start time and end time are required.");
      return;
    }

    const minHalf = parseMinutes(form.min_half_day_minutes, -1);
    const minFull = parseMinutes(form.min_full_day_minutes, -1);
    if (minHalf < 0 || minFull < 0) {
      setFormError("Threshold minutes must be valid non-negative numbers.");
      return;
    }

    const isUnique = await checkCodeUnique(form.code, form.id);
    if (!isUnique) return;

    setSaving(true);
    setFormError("");

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      break_minutes: parseMinutes(form.break_minutes, 0),
      grace_minutes: parseMinutes(form.grace_minutes, 0),
      min_half_day_minutes: minHalf,
      min_full_day_minutes: minFull,
      ot_after_minutes: form.ot_after_minutes.trim()
        ? parseMinutes(form.ot_after_minutes, 0)
        : null,
      is_night_shift: form.is_night_shift,
      is_active: form.is_active,
    };

    const query = form.id
      ? supabase.from("erp_hr_shifts").update(payload).eq("id", form.id)
      : supabase.from("erp_hr_shifts").insert(payload);

    const { error } = await query;

    if (error) {
      if (error.code === "23505") {
        setFormError("Shift code must be unique.");
      } else {
        setFormError(error.message || "Unable to save shift.");
      }
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: form.id ? "Shift updated." : "Shift created." });
    setSaving(false);
    await loadShifts();
    resetForm();
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading shifts…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Shift Masters</h1>
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
        <p style={eyebrowStyle}>HR · Shifts</p>
        <h1 style={titleStyle}>Shift Masters</h1>
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
          <p style={eyebrowStyle}>HR · Shifts</p>
          <h1 style={titleStyle}>Shift Masters</h1>
          <p style={subtitleStyle}>Define working hours, thresholds, and overtime rules.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={linkStyle}>
            ← Back to HR Home
          </Link>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Start</th>
                <th style={thStyle}>End</th>
                <th style={thStyle}>Break (min)</th>
                <th style={thStyle}>Grace (min)</th>
                <th style={thStyle}>Half/Full Thresholds</th>
                <th style={thStyle}>OT After (min)</th>
                <th style={thStyle}>Night</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, textAlign: "center" }}>
                    No shifts created yet.
                  </td>
                </tr>
              ) : (
                shifts.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.code}</td>
                    <td style={tdStyle}>{row.name}</td>
                    <td style={tdStyle}>{row.start_time}</td>
                    <td style={tdStyle}>{row.end_time}</td>
                    <td style={tdStyle}>{row.break_minutes}</td>
                    <td style={tdStyle}>{row.grace_minutes}</td>
                    <td style={tdStyle}>
                      {row.min_half_day_minutes}/{row.min_full_day_minutes}
                    </td>
                    <td style={tdStyle}>{row.ot_after_minutes ?? "—"}</td>
                    <td style={tdStyle}>{row.is_night_shift ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{row.is_active ? "Active" : "Inactive"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button type="button" onClick={() => beginEdit(row)} style={smallButtonStyle}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ ...sectionStyle, marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>Create / Edit Shift</h2>
        <form onSubmit={handleSubmit} style={{ ...formStyle, marginTop: 12 }}>
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Code *
              <input
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="e.g., DAY"
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Name *
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Day Shift"
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Start Time *
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              End Time *
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Break Minutes
              <input
                type="number"
                min={0}
                value={form.break_minutes}
                onChange={(e) => setForm((prev) => ({ ...prev, break_minutes: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Grace Minutes
              <input
                type="number"
                min={0}
                value={form.grace_minutes}
                onChange={(e) => setForm((prev) => ({ ...prev, grace_minutes: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Half-day Threshold (min)
              <input
                type="number"
                min={0}
                value={form.min_half_day_minutes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, min_half_day_minutes: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Full-day Threshold (min)
              <input
                type="number"
                min={0}
                value={form.min_full_day_minutes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, min_full_day_minutes: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              OT After Minutes
              <input
                type="number"
                min={0}
                value={form.ot_after_minutes}
                onChange={(e) => setForm((prev) => ({ ...prev, ot_after_minutes: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Night Shift
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={form.is_night_shift}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_night_shift: e.target.checked }))}
                />
                <span style={{ color: "#4b5563" }}>Counts as night shift</span>
              </div>
            </label>
            <label style={labelStyle}>
              Active
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                <span style={{ color: "#4b5563" }}>Available for scheduling</span>
              </div>
            </label>
          </div>

          {formError ? <div style={errorBoxStyle}>{formError}</div> : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button type="button" onClick={resetForm} style={buttonStyleLink}>
              Clear
            </button>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? "Saving..." : form.id ? "Update Shift" : "Save Shift"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1180,
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

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontWeight: 600,
  backgroundColor: "#f9fafb",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
  whiteSpace: "nowrap",
};

const formStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#f9fafb",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
  backgroundColor: "#fff",
  cursor: "pointer",
};

const smallButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  color: "#111827",
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
