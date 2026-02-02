-- 0365_enable_pgcrypto.sql
-- Enable pgcrypto for employee password hashing

create extension if not exists pgcrypto;
