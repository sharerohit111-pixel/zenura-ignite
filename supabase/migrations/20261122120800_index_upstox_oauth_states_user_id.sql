-- Cover the user_id foreign key for account-scoped OAuth state expiry and cleanup queries.
CREATE INDEX IF NOT EXISTS upstox_oauth_states_user_id_idx
  ON public.upstox_oauth_states(user_id);
