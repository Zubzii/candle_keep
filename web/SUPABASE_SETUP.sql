-- ============================================================================
-- GitHub Small Repos Tracker - Supabase Setup
-- Run these queries in order in your Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Create Tables
-- ============================================================================

-- github_repos: Canonical repository identity + metadata
CREATE TABLE IF NOT EXISTS github_repos (
  repo_id BIGINT PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  html_url TEXT NOT NULL,
  api_url TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  owner_type TEXT, -- 'User' or 'Organization'
  description TEXT,
  language TEXT,
  is_fork BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ,
  pushed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_repos_pushed_at ON github_repos(pushed_at);
CREATE INDEX IF NOT EXISTS idx_github_repos_last_seen_at ON github_repos(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_github_repos_full_name ON github_repos(full_name);

-- github_repo_snapshots: Time-series snapshots for growth calculations
CREATE TABLE IF NOT EXISTS github_repo_snapshots (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT NOT NULL REFERENCES github_repos(repo_id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  captured_date DATE NOT NULL, -- UTC date for idempotent upserts
  stars_count INT NOT NULL,
  forks_count INT,
  open_issues_count INT,
  source TEXT DEFAULT 'search' -- 'search', 'manual', etc.
);

-- Unique constraint ensures one snapshot per repo per day (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_repo_snapshots_repo_date 
  ON github_repo_snapshots(repo_id, captured_date);

CREATE INDEX IF NOT EXISTS idx_github_repo_snapshots_repo_id ON github_repo_snapshots(repo_id);
CREATE INDEX IF NOT EXISTS idx_github_repo_snapshots_captured_at ON github_repo_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_github_repo_snapshots_captured_date ON github_repo_snapshots(captured_date);

-- github_search_tasks: Work queue of partitioned search queries
CREATE TABLE IF NOT EXISTS github_search_tasks (
  id BIGSERIAL PRIMARY KEY,
  created_from DATE NOT NULL,
  created_to DATE NOT NULL,
  stars_min INT NOT NULL,
  stars_max INT, -- NULL means no upper bound
  pushed_after DATE,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'in_progress', 'done', 'needs_split', 'disabled')),
  page INT DEFAULT 1,
  refresh_every_days INT DEFAULT 7,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_search_tasks_status ON github_search_tasks(status);
CREATE INDEX IF NOT EXISTS idx_github_search_tasks_last_completed_at ON github_search_tasks(last_completed_at);
CREATE INDEX IF NOT EXISTS idx_github_search_tasks_ready_due ON github_search_tasks(status, last_completed_at) 
  WHERE status IN ('ready', 'done');

-- github_repo_trends: Materialized "latest trend result per repo"
CREATE TABLE IF NOT EXISTS github_repo_trends (
  repo_id BIGINT PRIMARY KEY REFERENCES github_repos(repo_id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  stars_now INT NOT NULL,
  stars_prev INT,
  prev_captured_at TIMESTAMPTZ,
  abs_growth_14d INT,
  pct_growth_14d DOUBLE PRECISION,
  score DOUBLE PRECISION,
  is_new BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_github_repo_trends_score ON github_repo_trends(score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_github_repo_trends_computed_at ON github_repo_trends(computed_at);

-- github_runs: Optional logging table for cron runs
CREATE TABLE IF NOT EXISTS github_runs (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL, -- 'github-discover' or 'github-score'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  tasks_processed INT DEFAULT 0,
  repos_upserted INT DEFAULT 0,
  snapshots_upserted INT DEFAULT 0,
  errors_count INT DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_github_runs_started_at ON github_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_runs_endpoint ON github_runs(endpoint);

-- Comments for documentation
COMMENT ON TABLE github_repos IS 'Canonical repository identity and metadata from GitHub API';
COMMENT ON TABLE github_repo_snapshots IS 'Time-series snapshots of repo metrics (stars, forks, issues) for growth calculations';
COMMENT ON TABLE github_search_tasks IS 'Work queue of partitioned GitHub search queries to avoid 1,000 result limit';
COMMENT ON TABLE github_repo_trends IS 'Materialized view of latest 14-day growth metrics per repo, computed from snapshots';
COMMENT ON TABLE github_runs IS 'Logging table for cron job execution history';

-- ============================================================================
-- MIGRATION 2: Create RPC Function for Task Claiming
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

-- ============================================================================
-- MIGRATION 3: Create Optional RPC Function for Efficient Trend Computation
-- (Optional but recommended for better performance)
-- ============================================================================

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

-- ============================================================================
-- VERIFICATION QUERIES (Run these to verify setup)
-- ============================================================================

-- Check that all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'github%'
ORDER BY table_name;

-- Check that RPC functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE '%github%'
ORDER BY routine_name;

-- Check table row counts (should all be 0 initially)
SELECT 
  'github_repos' as table_name, COUNT(*) as row_count FROM github_repos
UNION ALL
SELECT 'github_repo_snapshots', COUNT(*) FROM github_repo_snapshots
UNION ALL
SELECT 'github_search_tasks', COUNT(*) FROM github_search_tasks
UNION ALL
SELECT 'github_repo_trends', COUNT(*) FROM github_repo_trends
UNION ALL
SELECT 'github_runs', COUNT(*) FROM github_runs;

