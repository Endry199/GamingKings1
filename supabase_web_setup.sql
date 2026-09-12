-- Ejecutar en Supabase SQL Editor.
-- Renombra el saldo solo si todavía conserva el nombre anterior.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'saldos'
      and column_name = 'saldo_usd'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'saldos'
      and column_name = 'saldo_ncoins'
  ) then
    alter table public.saldos rename column saldo_usd to saldo_ncoins;
  end if;
end $$;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  id_transaccion text not null unique,
  "finalPrice" numeric not null,
  base_amount numeric not null,
  currency text not null,
  "paymentMethod" text not null,
  receipt_url text not null,
  status text not null default 'pendiente',
  google_id text not null,
  email text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text
);

create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  purpose text not null check (purpose in ('register', 'login')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null
);

create index if not exists email_verification_codes_lookup_idx
  on public.email_verification_codes (email, purpose, expires_at);

alter table public.transactions enable row level security;
alter table public.saldos enable row level security;
alter table public.email_verification_codes enable row level security;

create policy "Public can view active products"
  on public.productos for select to anon, authenticated using (activo = true);

create policy "Public can view packages"
  on public.paquetes for select to anon, authenticated using (true);

create policy "Users can view own balance"
  on public.saldos for select to authenticated using (user_id = auth.uid()::text);

create policy "Users can create own transactions"
  on public.transactions for insert to authenticated with check (google_id = auth.uid()::text);

create policy "Users can view own transactions"
  on public.transactions for select to authenticated using (google_id = auth.uid()::text);

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do update set public = true;

create policy "Users upload own payment proofs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Public can view payment proofs"
  on storage.objects for select to public
  using (bucket_id = 'payment-proofs');

-- Configura el webhook de Telegram en Netlify con:
-- https://TU-SITIO.netlify.app/.netlify/functions/telegram-webhook
-- y registra esa URL mediante la API de Telegram setWebhook.
