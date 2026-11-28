-- S-TRADE: encrypted, per-user broker connection storage.
-- Secrets are AES-256-GCM envelopes only; plaintext credentials are never persisted.
create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_name text not null check (broker_name in ('upstox','fyers','angel_one')),
  connection_status text not null default 'disconnected'
    check (connection_status in ('pending','connected','expired','revoked','error','disconnected')),
  access_token_ciphertext jsonb,
  refresh_token_ciphertext jsonb,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  provider_account_ref text,
  granted_scopes text[] not null default '{}',
  last_authenticated_at timestamptz,
  last_refreshed_at timestamptz,
  last_error_code text,
  encryption_key_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_connections_token_envelope_check check (
    (access_token_ciphertext is null or (
      jsonb_typeof(access_token_ciphertext) = 'object'
      and access_token_ciphertext ? 'v'
      and access_token_ciphertext ? 'iv'
      and access_token_ciphertext ? 'tag'
      and access_token_ciphertext ? 'data'
    ))
    and
    (refresh_token_ciphertext is null or (
      jsonb_typeof(refresh_token_ciphertext) = 'object'
      and refresh_token_ciphertext ? 'v'
      and refresh_token_ciphertext ? 'iv'
      and refresh_token_ciphertext ? 'tag'
      and refresh_token_ciphertext ? 'data'
    ))
  )
);

create unique index if not exists broker_connections_user_broker_uq
  on public.broker_connections(user_id, broker_name);

create index if not exists broker_connections_status_expiry_idx
  on public.broker_connections(connection_status, token_expires_at);

alter table public.broker_connections enable row level security;
alter table public.broker_connections force row level security;

-- No authenticated/client role receives SELECT/INSERT/UPDATE on encrypted credential rows.
revoke all on public.broker_connections from anon, authenticated;
grant select, insert, update, delete on public.broker_connections to service_role;

comment on table public.broker_connections is
  'Server-only broker credentials. Token values must be AES-256-GCM ciphertext envelopes; never expose this table to browser clients.';
comment on column public.broker_connections.access_token_ciphertext is
  'AES-256-GCM envelope {v,iv,tag,data}; ciphertext only.';
comment on column public.broker_connections.refresh_token_ciphertext is
  'AES-256-GCM envelope {v,iv,tag,data}; ciphertext only.';
