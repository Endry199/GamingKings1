-- Ejecutar una sola vez en Supabase SQL Editor.
-- Habilita los códigos OTP para restablecer contraseñas.
alter table public.email_verification_codes
  drop constraint if exists email_verification_codes_purpose_check;

alter table public.email_verification_codes
  add constraint email_verification_codes_purpose_check
  check (purpose in ('register', 'login', 'reset'));