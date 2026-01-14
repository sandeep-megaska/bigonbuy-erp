-- Sprint-2A: attendance calendar read models

create or replace view public.erp_calendar_holidays_v
with (security_invoker = true) as
select
  company_id,
  calendar_id,
  holiday_date,
  name,
  holiday_type,
  is_optional
from public.erp_calendar_holidays;

create or replace view public.erp_calendar_locations_v
with (security_invoker = true) as
select
  company_id,
  calendar_id,
  work_location_id
from public.erp_calendar_locations;
