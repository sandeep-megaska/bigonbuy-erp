import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { listLocations, type LocationRow } from "../../../../lib/hrMastersApi";
import { supabase } from "../../../../lib/supabaseClient";

type CalendarForm = {
  code: string;
  name: string;
  timezone: string;
  is_default: boolean;
};

type HolidayRow = {
  id: string;
  holiday_date: string;
  name: string;
  holiday_type: "public" | "company";
  is_optional: boolean;
};

type MappingRow = {
  id: string;
  work_location_id: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type DefaultConflictState = {
  message: string;
  active: boolean;
};

const emptyForm: CalendarForm = {
  code: "",
  name: "",
  timezone: "",
  is_default: false,
};

const emptyHoliday = {
  holiday_date: "",
  name: "",
  holiday_type: "public" as "public" | "company",
  is_optional: false,
};

export default function HrCalendarDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [form, setForm] = useState<CalendarForm>({ ...emptyForm });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [defaultConflict, setDefaultConflict] = useState<DefaultConflictState>({
    message: "",
    active: false,
  });
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ ...emptyHoliday });
  const [holidayError, setHolidayError] = useState("");
  const [holidaySaving, setHolidaySaving] = useState(false);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [locationSelections, setLocationSelections] = useState<string[]>([]);
  const [mappingError, setMappingError] = useState("");
  const [mappingSaving, setMappingSaving] = useState(false);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const locationById = useMemo(() => {
    return locations.reduce<Record<string, LocationRow>>((acc, location) => {
      if (location.id) acc[location.id] = location;
      return acc;
    }, {});
  }, [locations]);

  const mappedLocationIds = useMemo(
    () => mappings.map((m) => m.work_location_id),

    [mappings]
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

      if (router.isReady && typeof id === "string") {
        await loadCalendarDetail(id);
      }
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  async function loadCalendarDetail(calendarIdValue: string) {
    setCalendarId(calendarIdValue);
    try {
      const [{ data: calendar, error }, holidayResult, mappingResult, locationsList] =
        await Promise.all([
          supabase
            .from("erp_calendars")
            .select("id, code, name, timezone, is_default")
            .eq("id", calendarIdValue)
            .maybeSingle(),
          supabase
            .from("erp_calendar_holidays")
            .select("id, holiday_date, name, holiday_type, is_optional")
            .eq("calendar_id", calendarIdValue)
            .order("holiday_date", { ascending: true }),
          supabase
            .from("erp_calendar_locations")
            .select("id, work_location_id")
            .eq("calendar_id", calendarIdValue)
            .order("created_at", { ascending: true }),
          listLocations(),
        ]);

      if (error) {
        setFormError(error.message || "Unable to load calendar.");
        return;
      }

      if (calendar) {
        setForm({
          code: calendar.code ?? "",
          name: calendar.name ?? "",
          timezone: calendar.timezone ?? "",
          is_default: calendar.is_default ?? false,
        });
      }

      setHolidays((holidayResult.data as HolidayRow[]) || []);
      setMappings((mappingResult.data as MappingRow[]) || []);
      setLocations(locationsList || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load calendar.";
      setFormError(message);
    }
  }

  async function saveCalendar(options?: { unsetDefault?: boolean }) {
    if (!calendarId) return;

    setSaving(true);
    setFormError("");
    setDefaultConflict({ message: "", active: false });

    if (options?.unsetDefault) {
      const { error: unsetError } = await supabase
        .from("erp_calendars")
        .update({ is_default: false })
        .eq("is_default", true)
        .neq("id", calendarId);
      if (unsetError) {
        setFormError(unsetError.message || "Unable to clear existing default calendar.");
        setSaving(false);
        return;
      }
    }

    const { error } = await supabase
      .from("erp_calendars")
      .update({
        code: form.code.trim(),
        name: form.name.trim(),
        timezone: form.timezone.trim() || null,
        is_default: form.is_default,
      })
      .eq("id", calendarId);

    if (error) {
      const message = error.message || "Unable to update calendar.";
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

    setToast({ type: "success", message: "Calendar updated successfully." });
    setSaving(false);
  }

  async function handleCalendarSave(event: FormEvent) {
    event.preventDefault();
    if (!canManage) {
      setFormError("Only HR/admin users can manage calendars.");
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }

    await saveCalendar();
  }

  function openHolidayModal() {
    setHolidayForm({ ...emptyHoliday });
    setHolidayError("");
    setHolidayModalOpen(true);
  }

  function closeHolidayModal() {
    setHolidayModalOpen(false);
    setHolidayForm({ ...emptyHoliday });
    setHolidayError("");
  }

  async function handleAddHoliday(event: FormEvent) {
    event.preventDefault();
    if (!calendarId) return;
    if (!canManage) {
      setHolidayError("Only HR/admin users can manage holidays.");
      return;
    }
    if (!holidayForm.holiday_date || !holidayForm.name.trim()) {
      setHolidayError("Date and name are required.");
      return;
    }

    const exists = holidays.some((holiday) => holiday.holiday_date === holidayForm.holiday_date);
    if (exists) {
      setHolidayError("A holiday already exists on this date.");
      return;
    }

    setHolidaySaving(true);
    setHolidayError("");

    const { data, error } = await supabase
      .from("erp_calendar_holidays")
      .insert({
        calendar_id: calendarId,
        holiday_date: holidayForm.holiday_date,
        name: holidayForm.name.trim(),
        holiday_type: holidayForm.holiday_type,
        is_optional: holidayForm.is_optional,
      })
      .select("id, holiday_date, name, holiday_type, is_optional")
      .single();

    if (error) {
      const message = error.message || "Unable to add holiday.";
      if (error.code === "23505") {
        setHolidayError("A holiday already exists on this date.");
      } else {
        setHolidayError(message);
      }
      setHolidaySaving(false);
      return;
    }

    setHolidays((prev) => [...prev, data as HolidayRow].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
    setHolidaySaving(false);
    closeHolidayModal();
  }

  async function handleDeleteHoliday(holidayId: string) {
    if (!calendarId) return;
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/admin users can manage holidays." });
      return;
    }

    const { error } = await supabase
      .from("erp_calendar_holidays")
      .delete()
      .eq("id", holidayId)
      .eq("calendar_id", calendarId);

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to delete holiday." });
      return;
    }

    setHolidays((prev) => prev.filter((holiday) => holiday.id !== holidayId));
  }

  async function handleAssignLocations(event: FormEvent) {
    event.preventDefault();
    if (!calendarId) return;
    if (!canManage) {
      setMappingError("Only HR/admin users can manage location mappings.");
      return;
    }

    const newIds = locationSelections.filter((locationId) => mappedLocationIds.indexOf(locationId) === -1);

    if (newIds.length === 0) {
      setMappingError("Select at least one new location to assign.");
      return;
    }

    setMappingSaving(true);
    setMappingError("");

    const { data, error } = await supabase
      .from("erp_calendar_locations")
      .insert(
        newIds.map((locationId) => ({
          calendar_id: calendarId,
          work_location_id: locationId,
        }))
      )
      .select("id, work_location_id");

    if (error) {
      const message = error.message || "Unable to assign locations.";
      if (error.code === "23505") {
        setMappingError("Some locations are already assigned to this calendar.");
      } else {
        setMappingError(message);
      }
      setMappingSaving(false);
      return;
    }

    setMappings((prev) => [...prev, ...(data as MappingRow[])]);
    setLocationSelections([]);
    setMappingSaving(false);
  }

  async function handleRemoveMapping(mappingId: string) {
    if (!calendarId) return;
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/admin users can manage location mappings." });
      return;
    }

    const { error } = await supabase
      .from("erp_calendar_locations")
      .delete()
      .eq("id", mappingId)
      .eq("calendar_id", calendarId);

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to remove mapping." });
      return;
    }

    setMappings((prev) => prev.filter((mapping) => mapping.id !== mappingId));
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
        <h1 style={titleStyle}>Edit Calendar</h1>
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

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Calendars</p>
          <h1 style={titleStyle}>Edit Attendance Calendar</h1>
          <p style={subtitleStyle}>Update calendar details, holidays, and location mappings.</p>
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
        <h2 style={sectionTitleStyle}>Calendar Details</h2>
        <form onSubmit={handleCalendarSave} style={formGridStyle}>
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
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? "Saving..." : "Save Calendar"}
            </button>
          </div>
        </form>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderRowStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Holidays</h2>
            <p style={sectionSubtitleStyle}>Manage public and company-specific holidays.</p>
          </div>
          <button type="button" onClick={openHolidayModal} style={primaryButtonStyle}>
            Add Holiday
          </button>
        </div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Optional</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: "center" }}>
                    No holidays configured yet.
                  </td>
                </tr>
              ) : (
                holidays.map((holiday) => (
                  <tr key={holiday.id}>
                    <td style={tdStyle}>{holiday.holiday_date}</td>
                    <td style={tdStyle}>{holiday.name}</td>
                    <td style={tdStyle}>{holiday.holiday_type === "public" ? "Public" : "Company"}</td>
                    <td style={tdStyle}>{holiday.is_optional ? "Yes" : "No"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteHoliday(holiday.id)}
                        style={smallButtonStyle}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Location Assignment</h2>
        <p style={sectionSubtitleStyle}>
          Assign work locations to this calendar so employees inherit the correct holiday schedule.
        </p>
        <form onSubmit={handleAssignLocations} style={mappingFormStyle}>
          <label style={labelStyle}>
            Available Locations
            <select
              multiple
              value={locationSelections}
              onChange={(e) =>
                setLocationSelections(Array.from(e.target.selectedOptions).map((option) => option.value))
              }
              style={selectStyle}
            >
              {locations.length === 0 ? (
                <option value="" disabled>
                  No locations available
                </option>
              ) : (
                locations.map((location) => (
                  <option
  key={location.id}
  value={location.id}
  disabled={mappedLocationIds.indexOf(location.id || "") !== -1}
>
  {location.name}
  {mappedLocationIds.indexOf(location.id || "") !== -1 ? " (assigned)" : ""}
</option>

                ))
              )}
            </select>
          </label>
          {mappingError ? <div style={errorBoxStyle}>{mappingError}</div> : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button type="submit" style={primaryButtonStyle} disabled={mappingSaving}>
              {mappingSaving ? "Saving..." : "Assign Locations"}
            </button>
          </div>
        </form>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Region</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ ...tdStyle, textAlign: "center" }}>
                    No locations assigned yet.
                  </td>
                </tr>
              ) : (
                mappings.map((mapping) => {
                  const location = locationById[mapping.work_location_id];
                  const region = location
                    ? [location.city, location.state, location.country].filter(Boolean).join(", ")
                    : "—";
                  return (
                    <tr key={mapping.id}>
                      <td style={tdStyle}>{location?.name || "Unknown location"}</td>
                      <td style={tdStyle}>{region || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveMapping(mapping.id)}
                          style={smallButtonStyle}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {holidayModalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>Add Holiday</h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Add a public or company holiday for this calendar.
                </p>
              </div>
              <button type="button" onClick={closeHolidayModal} style={buttonStyle}>
                Close
              </button>
            </div>
            <form onSubmit={handleAddHoliday} style={formGridStyle}>
              <label style={labelStyle}>
                Date *
                <input
                  type="date"
                  value={holidayForm.holiday_date}
                  onChange={(e) =>
                    setHolidayForm((prev) => ({ ...prev, holiday_date: e.target.value }))
                  }
                  style={inputStyle}
                  required
                />
              </label>
              <label style={labelStyle}>
                Name *
                <input
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Diwali"
                  style={inputStyle}
                  required
                />
              </label>
              <label style={labelStyle}>
                Type
                <select
                  value={holidayForm.holiday_type}
                  onChange={(e) =>
                    setHolidayForm((prev) => ({ ...prev, holiday_type: e.target.value as "public" | "company" }))
                  }
                  style={selectStyle}
                >
                  <option value="public">Public</option>
                  <option value="company">Company</option>
                </select>
              </label>
              <label style={labelStyle}>
                Optional
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={holidayForm.is_optional}
                    onChange={(e) =>
                      setHolidayForm((prev) => ({ ...prev, is_optional: e.target.checked }))
                    }
                  />
                  <span style={{ color: "#4b5563" }}>Employees can opt out</span>
                </div>
              </label>
              {holidayError ? <div style={errorBoxStyle}>{holidayError}</div> : null}
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={closeHolidayModal} style={buttonStyle}>
                  Cancel
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={holidaySaving}>
                  {holidaySaving ? "Saving..." : "Save Holiday"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
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

const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 20, color: "#111827" };

const sectionSubtitleStyle: CSSProperties = { margin: "6px 0 0", color: "#6b7280" };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  marginBottom: 28,
};

const sectionHeaderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const mappingFormStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  marginBottom: 16,
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

const selectStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  minHeight: 44,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

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
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
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

const smallButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  color: "#111827",
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

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 40,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "min(640px, 100%)",
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.2)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 16,
};
