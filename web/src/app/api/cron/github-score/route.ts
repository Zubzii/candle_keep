/**
 * GitHub Scoring Cron Endpoint
 * 
 * Computes 14-day growth metrics from snapshots and updates github_repo_trends.
 * 
 * Auth: ?secret=<CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Computes growth score from absolute and percentage growth.
 * Formula: abs_growth * ln(1 + max(pct_growth, 0))
 */
function computeScore(absGrowth: number, pctGrowth: number): number {
  if (absGrowth <= 0) return 0;
  return absGrowth * Math.log(1 + Math.max(pctGrowth, 0));
}

export async function GET(request: NextRequest) {
  // Auth check
  const secret = request.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  let reposProcessed = 0;
  let reposWithGrowth = 0;
  let newRepos = 0;
  const errors: string[] = [];

  try {
    // Get latest snapshot per repo + snapshot at least 14 days old
    // Using a lateral join to get both "now" and "prev" snapshots efficiently
    const { data: trends, error: queryError } = await supabaseServer.rpc(
      "compute_repo_trends_14d"
    );

    // If RPC doesn't exist, fall back to manual query
    if (queryError && queryError.message.includes("function") && queryError.message.includes("does not exist")) {
      // Fallback: manual computation
      const { data: repos } = await supabaseServer
        .from("github_repos")
        .select("repo_id");

      if (!repos) {
        return NextResponse.json({
          message: "No repos found",
          reposProcessed: 0,
          reposWithGrowth: 0,
          newRepos: 0,
          durationMs: Date.now() - startTime,
        });
      }

      for (const repo of repos) {
        try {
          // Get latest snapshot
          const { data: nowSnapshot } = await supabaseServer
            .from("github_repo_snapshots")
            .select("captured_at, stars_count")
            .eq("repo_id", repo.repo_id)
            .order("captured_at", { ascending: false })
            .limit(1)
            .single();

          if (!nowSnapshot) continue;

          // Get snapshot at least 14 days old
          const fourteenDaysAgo = new Date(nowSnapshot.captured_at);
          fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

          const { data: prevSnapshot } = await supabaseServer
            .from("github_repo_snapshots")
            .select("captured_at, stars_count")
            .eq("repo_id", repo.repo_id)
            .lte("captured_at", fourteenDaysAgo.toISOString())
            .order("captured_at", { ascending: false })
            .limit(1)
            .single();

          const starsNow = nowSnapshot.stars_count;
          const starsPrev = prevSnapshot?.stars_count;
          const isNew = !prevSnapshot;

          let absGrowth: number | null = null;
          let pctGrowth: number | null = null;
          let score: number | null = null;

          if (!isNew && starsPrev !== undefined) {
            absGrowth = starsNow - starsPrev;
            pctGrowth = absGrowth / Math.max(starsPrev, 1);
            score = computeScore(absGrowth, pctGrowth);
            reposWithGrowth++;
          } else {
            newRepos++;
          }

          // Upsert trend
          const { error: upsertError } = await supabaseServer
            .from("github_repo_trends")
            .upsert(
              {
                repo_id: repo.repo_id,
                computed_at: new Date().toISOString(),
                stars_now: starsNow,
                stars_prev: starsPrev || null,
                prev_captured_at: prevSnapshot?.captured_at || null,
                abs_growth_14d: absGrowth,
                pct_growth_14d: pctGrowth,
                score,
                is_new: isNew,
              },
              { onConflict: "repo_id" }
            );

          if (upsertError) {
            throw new Error(
              `Failed to upsert trend for repo ${repo.repo_id}: ${upsertError.message}`
            );
          }

          reposProcessed++;
        } catch (error: any) {
          const errorMsg = `Repo ${repo.repo_id} failed: ${error.message}`;
          errors.push(errorMsg);
          console.error(errorMsg, error);
        }
      }
    } else if (queryError) {
      throw queryError;
    } else if (trends) {
      // Use RPC results
      for (const trend of trends) {
        try {
          const starsNow = trend.stars_now;
          const starsPrev = trend.stars_prev;
          const isNew = !starsPrev;

          let absGrowth: number | null = null;
          let pctGrowth: number | null = null;
          let score: number | null = null;

          if (!isNew && starsPrev !== undefined) {
            absGrowth = starsNow - starsPrev;
            pctGrowth = absGrowth / Math.max(starsPrev, 1);
            score = computeScore(absGrowth, pctGrowth);
            reposWithGrowth++;
          } else {
            newRepos++;
          }

          const { error: upsertError } = await supabaseServer
            .from("github_repo_trends")
            .upsert(
              {
                repo_id: trend.repo_id,
                computed_at: new Date().toISOString(),
                stars_now: starsNow,
                stars_prev: starsPrev || null,
                prev_captured_at: trend.prev_captured_at || null,
                abs_growth_14d: absGrowth,
                pct_growth_14d: pctGrowth,
                score,
                is_new: isNew,
              },
              { onConflict: "repo_id" }
            );

          if (upsertError) {
            throw new Error(
              `Failed to upsert trend for repo ${trend.repo_id}: ${upsertError.message}`
            );
          }

          reposProcessed++;
        } catch (error: any) {
          const errorMsg = `Repo ${trend.repo_id} failed: ${error.message}`;
          errors.push(errorMsg);
          console.error(errorMsg, error);
        }
      }
    }

    // Log run
    await supabaseServer.from("github_runs").insert({
      endpoint: "github-score",
      completed_at: new Date().toISOString(),
      repos_upserted: reposProcessed,
      errors_count: errors.length,
      error_message: errors.length > 0 ? errors.join("; ") : null,
    });

    return NextResponse.json({
      message: "Scoring completed",
      reposProcessed,
      reposWithGrowth,
      newRepos,
      errors: errors.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error("Scoring endpoint error:", error);

    // Log failed run
    await supabaseServer.from("github_runs").insert({
      endpoint: "github-score",
      completed_at: new Date().toISOString(),
      repos_upserted: reposProcessed,
      errors_count: 1,
      error_message: error.message,
    });

    return NextResponse.json(
      {
        error: error.message,
        reposProcessed,
        reposWithGrowth,
        newRepos,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

