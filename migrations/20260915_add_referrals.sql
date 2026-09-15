-- Crear tablas para sistema de referidos
CREATE TABLE IF NOT EXISTS public.colaboradores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  code text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  constraint colaboradores_pkey PRIMARY KEY (id),
  constraint colaboradores_user_id_fkey FOREIGN KEY (user_id) REFERENCES usuarios (google_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  referrer_user_id text NOT NULL,
  referred_user_id text NOT NULL,
  transaction_id uuid NULL,
  profit numeric(12,2) NOT NULL DEFAULT 0.00,
  credited_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  constraint referral_earnings_pkey PRIMARY KEY (id),
  constraint referral_earnings_referrer_fkey FOREIGN KEY (referrer_user_id) REFERENCES usuarios (google_id) ON DELETE CASCADE
);

-- Añadir campo opcional en transactions para guardar el referidor
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS referrer_user_id text NULL;

ALTER TABLE IF EXISTS public.transactions
  ADD CONSTRAINT transactions_referrer_user_id_fkey FOREIGN KEY (referrer_user_id) REFERENCES usuarios (google_id) ON DELETE SET NULL;
