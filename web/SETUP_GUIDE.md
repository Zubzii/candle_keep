# GitHub Small Repos Tracker - Setup Guide

## Overview
This system discovers GitHub repositories matching your criteria, stores snapshots, computes 14-day growth metrics, and displays trending repos.

## Prerequisites
- Supabase project
- GitHub Personal Access Token (PAT)
- Vercel account (for deployment and cron)

## Step 1: Supabase Setup

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and service role key (Project Settings → API)

### 1.2 Run Migrations
1. Open Supabase SQL Editor
2. Run migrations in order:
   - `supabase/migrations/001_create_github_tables.sql`
   - `supabase/migrations/002_create_claim_tasks_rpc.sql`
   - `supabase/migrations/003_create_compute_trends_rpc.sql` (optional, for performance)

### 1.3 Verify Tables
Check that these tables exist:
- `github_repos`
- `github_repo_snapshots`
- `github_search_tasks`
- `github_repo_trends`
- `github_runs`

## Step 2: GitHub Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Generate a new token (classic) with `public_repo` scope
3. Copy the token (you won't see it again!)

## Step 3: Environment Variables

### Local Development
Copy `env.example` to `.env.local` and fill in:

```bash
# Supabase (public)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Supabase (server-only)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# GitHub
GITHUB_TOKEN=your_github_pat

# Cron Security
CRON_SECRET=generate_random_string_here

# Optional tuning
DISCOVERY_CREATED_FROM=2020-01-01
DISCOVERY_PUSHED_AFTER=2025-01-01
DISCOVERY_STARS_MIN=100
DISCOVERY_MAX_TASKS_PER_RUN=3
DISCOVERY_MAX_PAGES_PER_TASK=3
GITHUB_SEARCH_DELAY_MS=2100
```

### Vercel Deployment
1. Go to your Vercel project settings
2. Add all environment variables from above
3. **Important**: For `vercel.json` cron to work, Vercel will automatically inject `@CRON_SECRET` from your env vars

## Step 4: Deploy to Vercel

1. Push your code to GitHub
2. Import project in Vercel
3. Vercel will detect `vercel.json` and set up cron jobs automatically
4. Cron schedules:
   - **Discovery**: Hourly (`0 * * * *`)
   - **Scoring**: Weekly on Monday (`0 0 * * 1`)

## Step 5: Initial Seed (Optional)

The discovery endpoint will auto-seed tasks if the table is empty. To manually seed:

1. Call the discovery endpoint once:
   ```
   GET https://your-app.vercel.app/api/cron/github-discover?secret=YOUR_CRON_SECRET
   ```

2. This will create tasks partitioned by:
   - Monthly date windows (from `DISCOVERY_CREATED_FROM` to today)
   - Star bands: [100-200], [201-500], [501-1000], [1001-5000], [5001-20000], [20001+]

## Step 6: Monitor Progress

### Check Task Status
```sql
SELECT status, COUNT(*) 
FROM github_search_tasks 
GROUP BY status;
```

### Check Recent Runs
```sql
SELECT * 
FROM github_runs 
ORDER BY started_at DESC 
LIMIT 10;
```

### View Top Trends
Visit `/github` page in your app, or query:
```sql
SELECT 
  r.full_name,
  t.stars_now,
  t.abs_growth_14d,
  t.pct_growth_14d,
  t.score
FROM github_repo_trends t
JOIN github_repos r ON t.repo_id = r.repo_id
WHERE t.stars_now <= 2000 
  AND t.abs_growth_14d >= 20
ORDER BY t.score DESC
LIMIT 100;
```

## Troubleshooting

### Cron Not Running
- Check Vercel cron logs in dashboard
- Verify `CRON_SECRET` matches in env vars and `vercel.json`
- Ensure endpoints return 200 status

### Rate Limit Errors
- Increase `GITHUB_SEARCH_DELAY_MS` (default 2100ms)
- Reduce `DISCOVERY_MAX_TASKS_PER_RUN` and `DISCOVERY_MAX_PAGES_PER_TASK`
- Check GitHub API rate limit status

### Tasks Stuck in `in_progress`
- Tasks reset to `ready` after `refresh_every_days` (default 7)
- Or manually update: `UPDATE github_search_tasks SET status='ready' WHERE status='in_progress'`

### No Data in Trends
- Ensure discovery cron has run and created snapshots
- Wait for scoring cron to compute trends (runs weekly)
- Check that repos have snapshots at least 14 days apart

## Architecture Notes

### Partitioning Strategy
- **Date windows**: Monthly partitions to avoid 1,000 result limit
- **Star bands**: Further partitions by star count ranges
- **Auto-splitting**: Tasks hitting page 10 with full results are marked `needs_split`

### Rate Limiting
- Default 2.1s delay between requests
- Exponential backoff on 403/429 errors
- Respects `Retry-After` header

### Scoring Formula
```
abs_growth_14d = stars_now - stars_prev
pct_growth_14d = abs_growth_14d / max(stars_prev, 1)
score = abs_growth_14d * ln(1 + max(pct_growth_14d, 0))
```

## Next Steps

1. **Customize filters**: Adjust `DISCOVERY_*` env vars for your criteria
2. **Add more partitions**: Manually create tasks for specific date/star ranges
3. **Extend UI**: Add filters, sorting, or export functionality to `/github` page
4. **Monitor**: Set up alerts for cron failures or rate limit issues

