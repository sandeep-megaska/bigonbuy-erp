-- Reference table for Indian states/UTs with GST codes

create table if not exists public.erp_ref_india_states (
  code text primary key,
  name text not null,
  is_union_territory boolean not null default false,
  is_active boolean not null default true
);

insert into public.erp_ref_india_states (code, name, is_union_territory, is_active) values
  ('01', 'Jammu & Kashmir', true, true),
  ('02', 'Himachal Pradesh', false, true),
  ('03', 'Punjab', false, true),
  ('04', 'Chandigarh', true, true),
  ('05', 'Uttarakhand', false, true),
  ('06', 'Haryana', false, true),
  ('07', 'Delhi', true, true),
  ('08', 'Rajasthan', false, true),
  ('09', 'Uttar Pradesh', false, true),
  ('10', 'Bihar', false, true),
  ('11', 'Sikkim', false, true),
  ('12', 'Arunachal Pradesh', false, true),
  ('13', 'Nagaland', false, true),
  ('14', 'Manipur', false, true),
  ('15', 'Mizoram', false, true),
  ('16', 'Tripura', false, true),
  ('17', 'Meghalaya', false, true),
  ('18', 'Assam', false, true),
  ('19', 'West Bengal', false, true),
  ('20', 'Jharkhand', false, true),
  ('21', 'Odisha', false, true),
  ('22', 'Chhattisgarh', false, true),
  ('23', 'Madhya Pradesh', false, true),
  ('24', 'Gujarat', false, true),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu', true, true),
  ('27', 'Maharashtra', false, true),
  ('28', 'Andhra Pradesh', false, true),
  ('29', 'Karnataka', false, true),
  ('30', 'Goa', false, true),
  ('31', 'Lakshadweep', true, true),
  ('32', 'Kerala', false, true),
  ('33', 'Tamil Nadu', false, true),
  ('34', 'Puducherry', true, true),
  ('35', 'Andaman and Nicobar Islands', true, true),
  ('36', 'Telangana', false, true),
  ('37', 'Andhra Pradesh (New)', false, true),
  ('38', 'Ladakh', true, true)
on conflict (code) do nothing;

create or replace function public.erp_ref_india_states_list()
returns setof public.erp_ref_india_states
language sql
security definer
set search_path = public
as $$
  select *
  from public.erp_ref_india_states
  where is_active
  order by name;
$$;

revoke all on function public.erp_ref_india_states_list() from public;
grant execute on function public.erp_ref_india_states_list() to authenticated;
