-- Expand allowed contact_type values to match UI + future needs

alter table public.erp_employee_contacts
  drop constraint if exists erp_employee_contacts_type_check;

alter table public.erp_employee_contacts
  add constraint erp_employee_contacts_type_check
  check (
    contact_type in (
      'work_email',
      'personal_email',
      'mobile',
      'whatsapp',
      'phone',
      'email'
    )
  );
