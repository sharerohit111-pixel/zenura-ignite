-- Migration history reconciliation: the idempotent worker-lease migration was applied twice to the live project.
-- The first matching version (20261122121443) contains the schema change; this version is intentionally a no-op.
select 1;
