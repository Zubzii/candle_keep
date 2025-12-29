# GitHub Small Repos Tracker - Implementation Plan

## Overview
Build a system that discovers GitHub repos matching filters, stores snapshots, computes growth metrics, and runs automatically via Vercel Cron.

## Implementation Phases

### Phase 1: Database Foundation
**Goal**: Set up Supabase schema and RPC functions

1. **Create Supabase tables**:
   - `github_repos` - Canonical repo identity + metadata
   - `github_repo_snapshots` - Time-series snapshots for growth calculations
   - `github_search_tasks` - Work queue of partitioned search queries
   - `github_repo_trends` - Materialized "latest trend result per repo"
   - `github_runs` (optional) - Logging cron runs

2. **Create indexes** for performance:
   - `github_repos`: `pushed_at`, `last_seen_at`
   - `github_repo_snapshots`: `(repo_id, captured_date)` unique constraint
   - `github_search_tasks`: `status`, `last_completed_at`

3. **Create RPC function**: `claim_github_tasks(p_limit int)`
   - Atomic task claiming with row locking
   - Prevents concurrency issues

**Deliverables**: SQL migration files in `web/supabase/migrations/`

---

### Phase 2: Core Infrastructure
**Goal**: Build GitHub API client, task seeding, and environment setup

1. **Environment variables**:
   - Add to `.env.example` and document in README
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, `CRON_SECRET`
   - Optional tuning vars: `DISCOVERY_CREATED_FROM`, `DISCOVERY_PUSHED_AFTER`, etc.

2. **GitHub API client** (`web/src/lib/github/client.ts`):
   - Query builder for GitHub Search API
   - Rate limiting (2s delay between requests)
   - Exponential backoff on 403/429
   - Respect `Retry-After` header

3. **Task seeder** (`web/src/lib/github/task-seeder.ts`):
   - Partitioning strategy: monthly date windows × star bands
   - Creates initial `github_search_tasks` rows
   - Handles needs_split detection

**Deliverables**: Client library, seeder utility, env docs

---

### Phase 3: Vercel Cron Endpoints
**Goal**: Implement discovery and scoring endpoints

1. **`/api/cron/github-discover`**:
   - Auth: `?secret=<CRON_SECRET>`
   - Seed tasks if empty
   - Claim N tasks via RPC
   - For each task: fetch pages, upsert repos/snapshots
   - Handle `needs_split` when hitting page 10 limit
   - Return stats JSON

2. **`/api/cron/github-score`**:
   - Auth: `?secret=<CRON_SECRET>`
   - Compute 14-day growth metrics
   - Calculate: `abs_growth_14d`, `pct_growth_14d`, `score`
   - Upsert into `github_repo_trends`

**Deliverables**: Two route handlers in `web/src/app/api/cron/`

---

### Phase 4: Integration & UI
**Goal**: Wire up cron schedules and add GitHub tab UI

1. **Vercel cron config** (`vercel.json`):
   - `/api/cron/github-discover` → hourly
   - `/api/cron/github-score` → weekly (Monday)

2. **GitHub tab page** (`web/src/app/github/page.tsx`):
   - Query `github_repo_trends` joined with `github_repos`
   - Display top trends sorted by `score`
   - Filter: small repos (stars_now <= 2000) + fast growth (abs_growth_14d >= 20)

**Deliverables**: `vercel.json`, GitHub page component

---

## Technical Decisions

### Partitioning Strategy
- **Date windows**: Monthly partitions (e.g., 2020-01-01..2020-01-31)
- **Star bands**: [100..200], [201..500], [501..1000], [1001..5000], [5001..20000], [20001..∞]
- **Auto-splitting**: When task hits page 10 with 100 results, mark `needs_split`

### Rate Limiting
- Default delay: 2100ms between requests
- Exponential backoff: 2^n seconds on 403/429
- Respect `Retry-After` header when present

### Scoring Formula
```
abs_growth_14d = stars_now - stars_prev
pct_growth_14d = abs_growth_14d / max(stars_prev, 1)
score = abs_growth_14d * ln(1 + max(pct_growth_14d, 0))
```

---

## File Structure
```
web/
├── supabase/
│   └── migrations/
│       ├── 001_create_github_tables.sql
│       └── 002_create_claim_tasks_rpc.sql
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── cron/
│   │   │       ├── github-discover/
│   │   │       │   └── route.ts
│   │   │       └── github-score/
│   │   │           └── route.ts
│   │   └── github/
│   │       └── page.tsx
│   └── lib/
│       ├── supabase/
│       │   └── server.ts (server-side client)
│       └── github/
│           ├── client.ts
│           └── task-seeder.ts
├── vercel.json
└── env.example
```

---

## Testing Strategy

1. **Local testing**: Use Vercel CLI to test cron endpoints
2. **Manual seeding**: Run seeder script to populate initial tasks
3. **Dry run**: Test with `DISCOVERY_MAX_TASKS_PER_RUN=1` and `DISCOVERY_MAX_PAGES_PER_TASK=1`
4. **Monitor**: Check Supabase logs and Vercel function logs

---

## Next Steps
Start with Phase 1: Create Supabase migration files.

