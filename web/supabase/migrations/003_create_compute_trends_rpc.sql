-- Optional RPC function for efficient trend computation
-- This can be used by the scoring endpoint for better performance

CREATE OR REPLACE FUNCTION compute_repo_trends_14d()
RETURNS TABLE (
  repo_id BIGINT,
  stars_now INT,
  stars_prev INT,
  prev_captured_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH latest_snapshots AS (
    SELECT DISTINCT ON (repo_id)
      repo_id,
      captured_at,
      stars_count
    FROM github_repo_snapshots
    ORDER BY repo_id, captured_at DESC
  ),
  prev_snapshots AS (
    SELECT DISTINCT ON (s.repo_id)
      s.repo_id,
      s.captured_at,
      s.stars_count
    FROM github_repo_snapshots s
    INNER JOIN latest_snapshots ls ON s.repo_id = ls.repo_id
    WHERE s.captured_at <= ls.captured_at - INTERVAL '14 days'
    ORDER BY s.repo_id, s.captured_at DESC
  )
  SELECT
    ls.repo_id,
    ls.stars_count AS stars_now,
    COALESCE(ps.stars_count, NULL) AS stars_prev,
    ps.captured_at AS prev_captured_at
  FROM latest_snapshots ls
  LEFT JOIN prev_snapshots ps ON ls.repo_id = ps.repo_id;
END;
$$;

COMMENT ON FUNCTION compute_repo_trends_14d IS 
  'Efficiently computes latest snapshot + snapshot from 14+ days ago for all repos. Used by scoring endpoint.';

