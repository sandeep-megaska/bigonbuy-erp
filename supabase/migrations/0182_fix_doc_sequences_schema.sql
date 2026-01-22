-- 0182_fix_doc_sequences_schema.sql
-- Normalize erp_doc_sequences to use doc_key instead of doc_type

alter table erp_doc_sequences
  rename column doc_type to doc_key;

-- safety: ensure not null + index
alter table erp_doc_sequences
  alter column doc_key set not null;

create index if not exists idx_erp_doc_sequences_key
  on erp_doc_sequences(company_id, fiscal_year, doc_key);
