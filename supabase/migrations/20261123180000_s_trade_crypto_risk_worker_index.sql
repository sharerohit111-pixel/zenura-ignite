-- Support deterministic oldest-active-plan scans used by the Crypto SL/Target worker.
-- Partial index excludes terminal plans and keeps worker batches bounded.
create index if not exists paper_crypto_active_risk_worker_idx
  on public.paper_crypto_risk_plans(updated_at,plan_id)
  where status='ACTIVE';
