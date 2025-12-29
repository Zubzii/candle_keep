-- GitHub Small Repos Tracker - Schema Migration
-- Creates tables for repo discovery, snapshots, tasks, and trends

-- ============================================================================
-- github_repos: Canonical repository identity + metadata
-- ============================================================================
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

-- ============================================================================
-- github_repo_snapshots: Time-series snapshots for growth calculations
-- ============================================================================
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

-- ============================================================================
-- github_search_tasks: Work queue of partitioned search queries
-- ============================================================================
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

-- ============================================================================
-- github_repo_trends: Materialized "latest trend result per repo"
-- ============================================================================
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

-- ============================================================================
-- github_runs: Optional logging table for cron runs
-- ============================================================================
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

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE github_repos IS 'Canonical repository identity and metadata from GitHub API';
COMMENT ON TABLE github_repo_snapshots IS 'Time-series snapshots of repo metrics (stars, forks, issues) for growth calculations';
COMMENT ON TABLE github_search_tasks IS 'Work queue of partitioned GitHub search queries to avoid 1,000 result limit';
COMMENT ON TABLE github_repo_trends IS 'Materialized view of latest 14-day growth metrics per repo, computed from snapshots';
COMMENT ON TABLE github_runs IS 'Logging table for cron job execution history';

