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
  purpose text not null check (purpose in ('register', 'login', 'reset')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null
);

alter table public.email_verification_codes
  drop constraint if exists email_verification_codes_purpose_check;
alter table public.email_verification_codes
  add constraint email_verification_codes_purpose_check
  check (purpose in ('register', 'login', 'reset'));

create index if not exists email_verification_codes_lookup_idx
  on public.email_verification_codes (email, purpose, expires_at);

alter table public.transactions enable row level security;
alter table public.saldos enable row level security;
alter table public.email_verification_codes enable row level security;

drop policy if exists "Public can view active products" on public.productos;
create policy "Public can view active products"
  on public.productos for select to anon, authenticated using (activo = true);

drop policy if exists "Public can view packages" on public.paquetes;
create policy "Public can view packages"
  on public.paquetes for select to anon, authenticated using (true);

drop policy if exists "Users can view own balance" on public.saldos;
create policy "Users can view own balance"
  on public.saldos for select to authenticated using (user_id = auth.uid()::text);

drop policy if exists "Users can create own transactions" on public.transactions;
create policy "Users can create own transactions"
  on public.transactions for insert to authenticated with check (google_id = auth.uid()::text);

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions"
  on public.transactions for select to authenticated using (google_id = auth.uid()::text);

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do update set public = true;

drop policy if exists "Users upload own payment proofs" on storage.objects;
create policy "Users upload own payment proofs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Public can view payment proofs" on storage.objects;
create policy "Public can view payment proofs"
  on storage.objects for select to public
  using (bucket_id = 'payment-proofs');

-- Configura el webhook de Telegram en Netlify con:
-- https://TU-SITIO.netlify.app/.netlify/functions/telegram-webhook
-- y registra esa URL mediante la API de Telegram setWebhook.

-- Sincroniza cualquier usuario de Supabase Auth con las tablas de la aplicación.
-- Usa el UUID de auth.users como google_id para correo y Google por igual.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  display_name text;
  existing_user_id bigint;
begin
  display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, ''), '@', 1)
  );

  select id
  into existing_user_id
  from public.usuarios
  where google_id = new.id::text or email = new.email
  order by case when google_id = new.id::text then 0 else 1 end
  limit 1;

  if existing_user_id is null then
    insert into public.usuarios (google_id, email, nombre, foto_url, ultimo_login)
    values (
      new.id::text,
      new.email,
      display_name,
      coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
      now()
    );
  else
    update public.usuarios
    set google_id = new.id::text,
        email = new.email,
        nombre = display_name,
        foto_url = coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
        ultimo_login = now()
    where id = existing_user_id;
  end if;

  insert into public.saldos (user_id)
  values (new.id::text)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Repara usuarios creados antes de instalar el trigger.
insert into public.usuarios (google_id, email, nombre, foto_url, ultimo_login)
select
  u.id::text,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1)),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
  now()
from auth.users u
where u.email is not null
  and not exists (
    select 1
    from public.usuarios existing
    where existing.google_id = u.id::text or existing.email = u.email
  );

insert into public.saldos (user_id)
select existing.google_id
from auth.users u
join public.usuarios existing on existing.google_id = u.id::text
where not exists (
  select 1 from public.saldos s where s.user_id = existing.google_id
);
