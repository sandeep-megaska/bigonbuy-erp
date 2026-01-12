-- Employee documents foundation updates: storage path + HR reader/writer policies

-- Ensure HR reader role exists
insert into public.erp_roles (key, name)
values ('hr_reader', 'HR Reader')
on conflict (key) do nothing;

-- Helper: HR reader (select access)
create or replace function public.erp_is_hr_reader(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'hr_reader')
  )
$$;

revoke all on function public.erp_is_hr_reader(uuid) from public;
grant execute on function public.erp_is_hr_reader(uuid) to authenticated;

-- Extend employee documents with storage_path
alter table public.erp_employee_documents
  add column if not exists storage_path text;

update public.erp_employee_documents
   set storage_path = file_path
 where storage_path is null;

alter table public.erp_employee_documents
  alter column storage_path set not null;

-- Update document policies to use HR reader/writer semantics
DO $$
BEGIN
  drop policy if exists erp_employee_documents_select_hr on public.erp_employee_documents;
  drop policy if exists erp_employee_documents_select_self on public.erp_employee_documents;
  drop policy if exists erp_employee_documents_write on public.erp_employee_documents;

  create policy erp_employee_documents_select_hr
    on public.erp_employee_documents
    for select
    using (
      company_id = public.erp_current_company_id()
      and coalesce(is_deleted, false) = false
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_employee_documents_select_self
    on public.erp_employee_documents
    for select
    using (
      company_id = public.erp_current_company_id()
      and coalesce(is_deleted, false) = false
      and doc_type <> 'id_proof'
      and auth.uid() is not null
      and (
        exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_documents_write
    on public.erp_employee_documents
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
END
$$;

-- Storage bucket for employee documents
DO $$
BEGIN
  if not exists (select 1 from storage.buckets where id = 'erp-employee-docs') then
    insert into storage.buckets (id, name, public) values ('erp-employee-docs', 'erp-employee-docs', false);
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'erp_employee_docs_read'
  ) then
    drop policy erp_employee_docs_read on storage.objects;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'erp_employee_docs_write'
  ) then
    drop policy erp_employee_docs_write on storage.objects;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'erp_employee_docs_delete'
  ) then
    drop policy erp_employee_docs_delete on storage.objects;
  end if;

  create policy erp_employee_docs_read
    on storage.objects
    for select
    using (
      bucket_id = 'erp-employee-docs'
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_employee_docs_write
    on storage.objects
    for insert
    with check (
      bucket_id = 'erp-employee-docs'
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_docs_delete
    on storage.objects
    for delete
    using (
      bucket_id = 'erp-employee-docs'
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
END
$$;

-- Employee document RPCs
create or replace function public.erp_hr_employee_document_create(
  p_employee_id uuid,
  p_doc_type text,
  p_file_name text,
  p_storage_path text,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee public.erp_employees;
  v_doc_type text := lower(trim(coalesce(p_doc_type, '')));
  v_storage_path text := nullif(trim(coalesce(p_storage_path, '')), '');
  v_file_name text := nullif(trim(coalesce(p_file_name, '')), '');
  v_doc_id uuid;
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if v_doc_type not in ('photo', 'id_proof', 'offer_letter', 'certificate', 'other') then
    raise exception 'Invalid doc_type';
  end if;

  if v_storage_path is null then
    raise exception 'storage_path is required';
  end if;

  select *
    into v_employee
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;

  if not found then
    raise exception 'Employee not found for this company';
  end if;

  insert into public.erp_employee_documents (
    company_id,
    employee_id,
    doc_type,
    file_name,
    storage_path,
    file_path,
    notes,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    v_doc_type,
    v_file_name,
    v_storage_path,
    v_storage_path,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_doc_id;

  perform public.erp_log_hr_audit(
    'document',
    v_doc_id,
    'upload',
    jsonb_build_object(
      'employee_id', p_employee_id,
      'doc_type', v_doc_type,
      'storage_path', v_storage_path,
      'file_name', v_file_name
    )
  );

  return v_doc_id;
end;
$$;

revoke all on function public.erp_hr_employee_document_create(uuid, text, text, text, text) from public;
grant execute on function public.erp_hr_employee_document_create(uuid, text, text, text, text) to authenticated;

create or replace function public.erp_hr_employee_document_delete(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc public.erp_employee_documents;
begin
  perform public.erp_require_hr_writer();

  if p_id is null then
    raise exception 'id is required';
  end if;

  select *
    into v_doc
    from public.erp_employee_documents d
   where d.id = p_id
     and d.company_id = v_company_id
     and coalesce(d.is_deleted, false) = false;

  if not found then
    raise exception 'Document not found';
  end if;

  update public.erp_employee_documents
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = auth.uid(),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_id
     and company_id = v_company_id;

  perform public.erp_log_hr_audit(
    'document',
    p_id,
    'delete',
    jsonb_build_object('employee_id', v_doc.employee_id)
  );
end;
$$;

revoke all on function public.erp_hr_employee_document_delete(uuid) from public;
grant execute on function public.erp_hr_employee_document_delete(uuid) to authenticated;
