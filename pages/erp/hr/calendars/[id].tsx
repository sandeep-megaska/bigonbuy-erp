import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { listLocations } from "../../../../lib/hrMastersApi";
import { supabase } from "../../../../lib/supabaseClient";

type CalendarRow = {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  is_default: boolean;
};

type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  holiday_type: "public" | "company";
  is_optional: boolean;
};

type LocationRow = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  is_active?: boolean | null;
};

type CalendarLocationRow = {
  id: string;
  work_location_id: string;
};

type ToastState = {
  type: "success" | "error" | "warning";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
} | null;

type HolidayFormState = {
  date: string;
  name: string;
  type: "public" | "company";
  optional: boolean;
};

const defaultHolidayForm: HolidayFormState = {
  date: "",
  name: "",
  type: "public",
  optional: false,
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

export default function HrCalendarDetailPage() {
  const router = useRouter();
  const calendarId = router.query.id as string | undefined;
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [calendar, setCalendar] = useState<CalendarRow | null>(null);
  const [form, setForm] = useState<CalendarRow | null>(null);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [holidayForm, setHolidayForm] = useState<HolidayFormState>({ ...defaultHolidayForm });
  const [holidayError, setHolidayError] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [calendarLocations, setCalendarLocations] = useState<CalendarLocationRow[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const locationMap = useMemo(() => {
    return locations.reduce<Record<string, LocationRow>>((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});
  }, [locations]);

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

      if (calendarId) {
        await Promise.all([loadCalendar(calendarId), loadHolidays(calendarId), loadLocations(), loadMappings(calendarId)]);
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, calendarId]);

  async function loadCalendar(id: string) {
    const { data, error } = await supabase
      .from("erp_calendars")
      .select("id, code, name, timezone, is_default")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load calendar." });
      return;
    }

    if (!data) {
      setToast({ type: "error", message: "Calendar not found." });
      return;
    }

    const row = data as CalendarRow;
    setCalendar(row);
    setForm({ ...row });
  }

  async function loadHolidays(id: string) {
    const { data, error } = await supabase
      .from("erp_calendar_holidays")
      .select("id, holiday_date, name, holiday_type, is_optional")
      .eq("calendar_id", id)
      .order("holiday_date", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load holidays." });
      return;
    }

    setHolidays((data as HolidayRow[]) || []);
  }

  async function loadLocations() {
    const { data, error } = await supabase
      .from("erp_work_locations")
      .select("id, name, city, state, country, is_active")
      .order("name", { ascending: true });

    if (error) {
      try {
        const fallback = await listLocations();
        setLocations((fallback as LocationRow[]) || []);
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : "Unable to load locations.";
        setToast({ type: "error", message });
      }
      return;
    }

    setLocations((data as LocationRow[]) || []);
  }

  async function loadMappings(id: string) {
    const { data, error } = await supabase
      .from("erp_calendar_locations")
      .select("id, work_location_id")
      .eq("calendar_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load location mappings." });
      return;
    }

    const rows = (data as CalendarLocationRow[]) || [];
    setCalendarLocations(rows);
    setSelectedLocationIds(rows.map((row) => row.work_location_id));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form || !calendarId) return;

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
      timezone: form.timezone?.trim() || null,
      is_default: form.is_default,
    };

    const { error } = await supabase
      .from("erp_calendars")
      .update(payload)
      .eq("id", calendarId);

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

    setToast({ type: "success", message: "Calendar updated successfully." });
    setSaving(false);
    await loadCalendar(calendarId);
  }

  async function handleReplaceDefault(payload: {
    code: string;
    name: string;
    timezone: string | null;
    is_default: boolean;
  }) {
    if (!ctx?.companyId || !calendarId) return;
    setSaving(true);

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

    const { error } = await supabase
      .from("erp_calendars")
      .update({ ...payload, is_default: true })
      .eq("id", calendarId);

    if (error) {
      setFormError(error.message || "Unable to save calendar after unsetting default.");
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Default calendar updated." });
    setSaving(false);
    await loadCalendar(calendarId);
  }

  function openHolidayModal() {
    setHolidayForm({ ...defaultHolidayForm });
    setHolidayError("");
    setHolidayModalOpen(true);
  }

  function closeHolidayModal() {
    setHolidayModalOpen(false);
    setHolidayError("");
  }

  async function handleHolidaySave(e: FormEvent) {
    e.preventDefault();
    if (!calendarId) return;

    if (!holidayForm.date || !holidayForm.name.trim()) {
      setHolidayError("Holiday date and name are required.");
      return;
    }

    const payload = {
      calendar_id: calendarId,
      holiday_date: holidayForm.date,
      name: holidayForm.name.trim(),
      holiday_type: holidayForm.type,
      is_optional: holidayForm.optional,
    };

    const { error } = await supabase.from("erp_calendar_holidays").insert(payload);

    if (error) {
      if (isHolidayDuplicate(error)) {
        setHolidayError("A holiday already exists for this date.");
      } else {
        setHolidayError(error.message || "Unable to save holiday.");
      }
      return;
    }

    closeHolidayModal();
    await loadHolidays(calendarId);
  }

  async function handleHolidayDelete(id: string) {
    if (!calendarId) return;
    const { error } = await supabase
      .from("erp_calendar_holidays")
      .delete()
      .eq("id", id)
      .eq("calendar_id", calendarId);

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to delete holiday." });
      return;
    }

    await loadHolidays(calendarId);
  }

  async function handleMappingSave() {
    if (!calendarId) return;
    setMappingSaving(true);

    const existingIds = new Set(calendarLocations.map((row) => row.work_location_id));
    const nextIds = new Set(selectedLocationIds);

    const toInsert = [...nextIds].filter((id) => !existingIds.has(id));
    const toDelete = calendarLocations.filter((row) => !nextIds.has(row.work_location_id)).map((row) => row.id);

    if (toInsert.length) {
      const payload = toInsert.map((id) => ({
        calendar_id: calendarId,
        work_location_id: id,
      }));
      const { error } = await supabase.from("erp_calendar_locations").insert(payload);
      if (error) {
        setToast({ type: "error", message: error.message || "Unable to add location mappings." });
        setMappingSaving(false);
        return;
      }
    }

    if (toDelete.length) {
      const { error } = await supabase
        .from("erp_calendar_locations")
        .delete()
        .in("id", toDelete);
      if (error) {
        setToast({ type: "error", message: error.message || "Unable to remove location mappings." });
        setMappingSaving(false);
        return;
      }
    }

    await loadMappings(calendarId);
    setToast({ type: "success", message: "Location mappings updated." });
    setMappingSaving(false);
  }

  async function handleRemoveMapping(mappingId: string) {
    if (!calendarId) return;
    const { error } = await supabase
      .from("erp_calendar_locations")
      .delete()
      .eq("id", mappingId)
      .eq("calendar_id", calendarId);

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to remove mapping." });
      return;
    }

    await loadMappings(calendarId);
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
        <h1 style={{ marginTop: 0 }}>Calendar</h1>
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
        <h1 style={{ marginTop: 0 }}>Calendar</h1>
        <p style={{ color: "#b91c1c" }}>Only HR/admin users can manage calendars.</p>
        <Link href="/erp/hr/calendars" style={linkStyle}>← Back to Calendars</Link>
      </div>
    );
  }

  if (!calendar || !form) {
    return (
      <div style={containerStyle}>
        <ErpNavBar access={access} roleKey={ctx?.roleKey} />
        <h1 style={{ marginTop: 0 }}>Calendar not found</h1>
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
          <h1 style={titleStyle}>{calendar.name}</h1>
          <p style={subtitleStyle}>Update calendar details, holidays, and location assignments.</p>
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
        <div style={toast.type === "error" ? errorBoxStyle : toast.type === "warning" ? warningBoxStyle : successBoxStyle}>
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
              onChange={(e) => setForm((prev) => (prev ? { ...prev, code: e.target.value } : prev))}
              style={inputStyle}
              placeholder="e.g., IND-STD"
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              style={inputStyle}
              placeholder="Standard India Calendar"
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Timezone</span>
            <input
              list="timezone-options"
              value={form.timezone || ""}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, timezone: e.target.value } : prev))}
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
              onChange={(e) => setForm((prev) => (prev ? { ...prev, is_default: e.target.checked } : prev))}
            />
            <span>Default calendar</span>
          </label>
        </div>
        <div style={buttonRowStyle}>
          <button type="submit" style={primaryButtonStyle} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Holidays</h2>
            <p style={sectionSubtitleStyle}>Add company or public holidays for this calendar.</p>
          </div>
          <button type="button" onClick={openHolidayModal} style={secondaryButtonStyle}>Add Holiday</button>
        </div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Optional</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.length ? (
                holidays.map((holiday) => (
                  <tr key={holiday.id}>
                    <td style={tdStyle}>{formatDate(holiday.holiday_date)}</td>
                    <td style={tdStyle}>{holiday.name}</td>
                    <td style={tdStyle}>{holiday.holiday_type}</td>
                    <td style={tdStyle}>{holiday.is_optional ? "Yes" : "No"}</td>
                    <td style={tdStyle}>
                      <button type="button" style={linkButtonStyle} onClick={() => handleHolidayDelete(holiday.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={emptyCellStyle} colSpan={5}>No holidays added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Location assignments</h2>
            <p style={sectionSubtitleStyle}>Map this calendar to work locations for scheduling coverage.</p>
          </div>
          <button type="button" onClick={handleMappingSave} style={secondaryButtonStyle} disabled={mappingSaving}>
            {mappingSaving ? "Saving…" : "Save Assignments"}
          </button>
        </div>

        <div style={gridCardStyle}>
          <div style={locationListStyle}>
            {locations.length ? (
              locations.map((location) => (
                <label key={location.id} style={locationItemStyle}>
                  <input
                    type="checkbox"
                    checked={selectedLocationIds.includes(location.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedLocationIds((prev) => {
                        if (checked) return [...prev, location.id];
                        return prev.filter((id) => id !== location.id);
                      });
                    }}
                  />
                  <span>
                    <strong>{location.name}</strong>
                    <div style={locationMetaStyle}>{formatLocation(location)}</div>
                  </span>
                </label>
              ))
            ) : (
              <p style={{ margin: 0, color: "#6b7280" }}>No work locations available.</p>
            )}
          </div>

          <div style={mappingListStyle}>
            <h3 style={mappingTitleStyle}>Mapped Locations</h3>
            {calendarLocations.length ? (
              <ul style={mappingItemsStyle}>
                {calendarLocations.map((mapping) => {
                  const location = locationMap[mapping.work_location_id];
                  return (
                    <li key={mapping.id} style={mappingItemStyle}>
                      <div>
                        <strong>{location?.name || "Unknown location"}</strong>
                        <div style={locationMetaStyle}>{formatLocation(location)}</div>
                      </div>
                      <button
                        type="button"
                        style={linkButtonStyle}
                        onClick={() => handleRemoveMapping(mapping.id)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ margin: 0, color: "#6b7280" }}>No locations mapped yet.</p>
            )}
          </div>
        </div>
      </section>

      {holidayModalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Add Holiday</h3>
              <button type="button" onClick={closeHolidayModal} style={linkButtonStyle}>Close</button>
            </div>
            <form onSubmit={handleHolidaySave} style={{ marginTop: 16, display: "grid", gap: 12 }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Date</span>
                <input
                  type="date"
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm((prev) => ({ ...prev, date: e.target.value }))}
                  style={inputStyle}
                  required
                />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>Name</span>
                <input
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm((prev) => ({ ...prev, name: e.target.value }))}
                  style={inputStyle}
                  placeholder="Holiday name"
                  required
                />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>Type</span>
                <select
                  value={holidayForm.type}
                  onChange={(e) =>
                    setHolidayForm((prev) => ({ ...prev, type: e.target.value as HolidayFormState["type"] }))
                  }
                  style={inputStyle}
                >
                  <option value="public">Public</option>
                  <option value="company">Company</option>
                </select>
              </label>
              <label style={checkboxFieldStyle}>
                <input
                  type="checkbox"
                  checked={holidayForm.optional}
                  onChange={(e) => setHolidayForm((prev) => ({ ...prev, optional: e.target.checked }))}
                />
                <span>Optional holiday</span>
              </label>
              {holidayError ? <div style={errorBoxStyle}>{holidayError}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" onClick={closeHolidayModal} style={secondaryButtonStyle}>Cancel</button>
                <button type="submit" style={primaryButtonStyle}>Save Holiday</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatLocation(location?: LocationRow) {
  if (!location) return "";
  return [location.city, location.state, location.country].filter(Boolean).join(", ") || "—";
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

function isHolidayDuplicate(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return (error.message || "").includes("erp_calendar_holidays_company_calendar_date_key");
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
  marginBottom: 32,
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

const secondaryButtonStyle = {
  backgroundColor: "#e5e7eb",
  color: "#111827",
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

const linkButtonStyle = {
  background: "none",
  border: "none",
  color: "#2563eb",
  cursor: "pointer",
  padding: 0,
  fontSize: 14,
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
  marginBottom: 32,
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap" as const,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 20,
  color: "#111827",
};

const sectionSubtitleStyle = {
  margin: "4px 0 0",
  color: "#6b7280",
  fontSize: 14,
};

const tableWrapStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 14,
};

const thStyle = {
  textAlign: "left" as const,
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  color: "#111827",
  fontWeight: 600,
};

const tdStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

const emptyCellStyle = {
  padding: "20px",
  textAlign: "center" as const,
  color: "#6b7280",
};

const gridCardStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  backgroundColor: "#fafafa",
};

const locationListStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  maxHeight: 280,
  overflowY: "auto" as const,
  paddingRight: 8,
};

const locationItemStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  fontSize: 14,
  color: "#111827",
};

const locationMetaStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const mappingListStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  backgroundColor: "#fff",
  borderRadius: 10,
  padding: 12,
  border: "1px solid #e5e7eb",
};

const mappingTitleStyle = {
  margin: 0,
  fontSize: 16,
  color: "#111827",
};

const mappingItemsStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: 10,
};

const mappingItemStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const modalOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 40,
};

const modalStyle = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.2)",
};

const successBoxStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  backgroundColor: "#ecfdf5",
  color: "#047857",
  border: "1px solid #a7f3d0",
  marginBottom: 18,
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
