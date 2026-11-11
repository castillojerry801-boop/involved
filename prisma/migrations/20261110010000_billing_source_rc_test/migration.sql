-- Add rc_test to BillingSource enum for RevenueCat Test Store sandbox support.
--
-- SAFE TO RUN: ALTER TYPE ... ADD VALUE is a non-transactional, non-locking DDL
-- in PostgreSQL. It cannot run inside a BEGIN/COMMIT block. The IF NOT EXISTS
-- guard makes it idempotent on re-run.
--
-- Production impact: none. No existing data is affected. No existing column
-- defaults or constraints reference this new value. The rc_test billing source
-- is only written when REVENUECAT_ACCEPT_TEST_STORE=true, which must NOT be set
-- in production. Production rows remain unchanged.
--
-- Apply to Preview only. Coordinate with REVENUECAT_ACCEPT_TEST_STORE Vercel
-- env var before activating Test Store webhook processing on sandbox.

ALTER TYPE "BillingSource" ADD VALUE IF NOT EXISTS 'rc_test';
