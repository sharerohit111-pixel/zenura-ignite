-- This project-level hardening was applied to the existing Supabase project
-- before the Paper Trading schema rollout. Keep it versioned with the repository.
-- The event-trigger function itself is preserved; only direct caller execution is revoked.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
