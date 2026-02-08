-- 0451_mfg_prod1_fix_reverse_core_no_rowtype.sql
-- No-op: 0450 contains the final implementation. Keep file to preserve migration sequence.
select pg_notify('pgrst', 'reload schema');
