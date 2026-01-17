begin;

alter table public.erp_salary_structures
  alter column ctc_monthly drop not null;

commit;
