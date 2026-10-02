-- =====================================================================
-- NAFILHCC ADMIN SYSTEM — UPGRADE v4 -> v5
-- Run this ONCE in the SQL Editor of your LIVE Supabase project.
--
-- What this does:
--   1. Adds a "property_type" column to the refunds register, so each
--      refund can be tagged with the property type it relates to (e.g.
--      "3 Bedroom Terrace — Old Rate") — this is what lets the Refunds
--      page total refunds per property type, matching the way Offers,
--      Allocations, and Payments already work.
--
-- Safe to run more than once, and safe even if this column already
-- exists on your project — every step checks first. Nothing is deleted.
-- =====================================================================

alter table refunds add column if not exists property_type text;

-- =====================================================================
-- DONE. Next: deploy the v5 frontend code.
-- =====================================================================
