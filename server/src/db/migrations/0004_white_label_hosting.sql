-- ===========================================================================
-- 0004 · White-label hosting
-- Lets a tenant be reached on its own domain/subdomain so the same deployment
-- can serve fully branded, per-customer URLs.
-- ===========================================================================

ALTER TABLE tenants ADD COLUMN domain text;

-- One custom domain per business; NULLs (tenants without one) are allowed.
CREATE UNIQUE INDEX tenants_domain_unique_idx ON tenants (domain) WHERE domain IS NOT NULL;

-- Login audit: keep the last login metadata on the user row for the UI.
ALTER TABLE users ADD COLUMN last_login_ip text;
