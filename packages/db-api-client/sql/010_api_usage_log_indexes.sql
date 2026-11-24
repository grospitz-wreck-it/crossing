-- Keep API usage dashboard and limiter reads on a bounded index range.
-- Safe to apply repeatedly; does not rewrite or delete usage history.
CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_created_cache_eva
ON api_usage_log (api_name, created_at, cache_hit, eva);
