-- GitHub Small Repos Tracker - RPC Functions
-- Atomic task claiming function to prevent concurrency issues

-- ============================================================================
-- claim_github_tasks: Atomically claim N tasks for processing
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_github_tasks(p_limit INT)
RETURNS TABLE (
  id BIGINT,
  created_from DATE,
  created_to DATE,
  stars_min INT,
  stars_max INT,
  pushed_after DATE,
  status TEXT,
  page INT,
  refresh_every_days INT,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_error TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT t.id
    FROM github_search_tasks t
    WHERE (
      -- Status must be ready, or done and due for refresh
      (t.status = 'ready')
      OR (
        t.status = 'done' 
        AND (
          t.last_completed_at IS NULL 
          OR t.last_completed_at < NOW() - (t.refresh_every_days || ' days')::INTERVAL
        )
      )
    )
    -- Lock rows to prevent concurrent claims (SKIP LOCKED allows other processes to continue)
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE github_search_tasks t
  SET 
    status = 'in_progress',
    last_started_at = NOW(),
    last_error = NULL,
    -- Reset page to 1 if task was previously done (starting fresh refresh)
    page = CASE WHEN t.status = 'done' THEN 1 ELSE t.page END
  FROM claimed c
  WHERE t.id = c.id
  RETURNING 
    t.id,
    t.created_from,
    t.created_to,
    t.stars_min,
    t.stars_max,
    t.pushed_after,
    t.status,
    t.page,
    t.refresh_every_days,
    t.last_started_at,
    t.last_completed_at,
    t.last_error;
END;
$$;

COMMENT ON FUNCTION claim_github_tasks IS 
  'Atomically claims up to p_limit tasks for processing. Uses FOR UPDATE SKIP LOCKED to prevent race conditions. Resets page to 1 if task was previously done.';

