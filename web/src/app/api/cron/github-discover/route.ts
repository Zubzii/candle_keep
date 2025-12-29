/**
 * GitHub Discovery Cron Endpoint
 * 
 * Claims tasks, fetches GitHub search results, and upserts repos/snapshots.
 * 
 * Auth: ?secret=<CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  searchRepositories,
  requireGitHubToken,
  type GitHubSearchParams,
  type GitHubRepo,
} from "@/lib/github/client";
import { seedTasks, getDefaultSeederConfig } from "@/lib/github/task-seeder";

const MAX_TASKS_PER_RUN = parseInt(
  process.env.DISCOVERY_MAX_TASKS_PER_RUN || "3",
  10
);
const MAX_PAGES_PER_TASK = parseInt(
  process.env.DISCOVERY_MAX_PAGES_PER_TASK || "3",
  10
);

/**
 * Upserts a repo into github_repos.
 */
async function upsertRepo(repo: GitHubRepo) {
  const { error } = await supabaseServer.from("github_repos").upsert(
    {
      repo_id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
      api_url: repo.url,
      owner_login: repo.owner.login,
      owner_type: repo.owner.type,
      description: repo.description,
      language: repo.language,
      is_fork: repo.fork,
      is_archived: repo.archived,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      last_seen_at: new Date().toISOString(),
    },
    {
      onConflict: "repo_id",
      ignoreDuplicates: false,
    }
  );

  if (error) {
    throw new Error(`Failed to upsert repo ${repo.full_name}: ${error.message}`);
  }
}

/**
 * Upserts a snapshot into github_repo_snapshots.
 */
async function upsertSnapshot(
  repoId: number,
  stars: number,
  forks: number,
  openIssues: number,
  source: string = "search"
) {
  const now = new Date();
  const capturedDate = now.toISOString().split("T")[0]; // YYYY-MM-DD

  const { error } = await supabaseServer.from("github_repo_snapshots").upsert(
    {
      repo_id: repoId,
      captured_at: now.toISOString(),
      captured_date: capturedDate,
      stars_count: stars,
      forks_count: forks,
      open_issues_count: openIssues,
      source,
    },
    {
      onConflict: "repo_id,captured_date",
      ignoreDuplicates: false,
    }
  );

  if (error) {
    throw new Error(
      `Failed to upsert snapshot for repo ${repoId}: ${error.message}`
    );
  }
}

/**
 * Processes a single task: fetches pages and upserts data.
 */
async function processTask(task: any, token: string): Promise<{
  reposUpserted: number;
  snapshotsUpserted: number;
  needsSplit: boolean;
  nextPage: number | null;
}> {
  let reposUpserted = 0;
  let snapshotsUpserted = 0;
  let currentPage = task.page;
  let needsSplit = false;
  let nextPage: number | null = null;

  // Fetch up to MAX_PAGES_PER_TASK pages
  for (let pageOffset = 0; pageOffset < MAX_PAGES_PER_TASK; pageOffset++) {
    const page = currentPage + pageOffset;

    const params: GitHubSearchParams = {
      createdFrom: task.created_from,
      createdTo: task.created_to,
      starsMin: task.stars_min,
      starsMax: task.stars_max || undefined,
      pushedAfter: task.pushed_after || undefined,
      page,
      perPage: 100,
    };

    const response = await searchRepositories(params, token);

    // Upsert repos and snapshots
    for (const repo of response.items) {
      await upsertRepo(repo);
      reposUpserted++;

      await upsertSnapshot(
        repo.id,
        repo.stargazers_count,
        repo.forks_count,
        repo.open_issues_count
      );
      snapshotsUpserted++;
    }

    // Check if we've reached the end
    const isLastPage = response.items.length < 100;
    const isPage10 = page >= 10;

    if (isLastPage) {
      // No more results, mark task as done
      nextPage = null;
      break;
    } else if (isPage10 && response.items.length === 100) {
      // Hit page 10 with full results - needs splitting
      needsSplit = true;
      nextPage = null;
      break;
    } else {
      // Continue to next page
      nextPage = page + 1;
    }
  }

  return { reposUpserted, snapshotsUpserted, needsSplit, nextPage };
}

/**
 * Updates task status after processing.
 */
async function updateTaskStatus(
  taskId: number,
  status: "done" | "needs_split" | "in_progress",
  nextPage: number | null,
  error?: string
) {
  const update: any = {
    status,
    last_completed_at: status === "done" ? new Date().toISOString() : null,
    last_error: error || null,
  };

  if (nextPage !== null) {
    update.page = nextPage;
  } else if (status === "done") {
    update.page = 1; // Reset for next refresh cycle
  }

  const { error: updateError } = await supabaseServer
    .from("github_search_tasks")
    .update(update)
    .eq("id", taskId);

  if (updateError) {
    throw new Error(`Failed to update task ${taskId}: ${updateError.message}`);
  }
}

export async function GET(request: NextRequest) {
  // Auth check
  const secret = request.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  let tasksProcessed = 0;
  let totalReposUpserted = 0;
  let totalSnapshotsUpserted = 0;
  const errors: string[] = [];

  try {
    // Ensure tasks are seeded
    const { data: existingTasks } = await supabaseServer
      .from("github_search_tasks")
      .select("id")
      .limit(1);

    if (!existingTasks || existingTasks.length === 0) {
      console.log("No tasks found, seeding...");
      const config = getDefaultSeederConfig();
      const { created, skipped } = await seedTasks(config);
      console.log(`Seeded ${created} tasks (skipped ${skipped} existing)`);
    }

    // Claim tasks
    const { data: claimedTasks, error: claimError } = await supabaseServer.rpc(
      "claim_github_tasks",
      { p_limit: MAX_TASKS_PER_RUN }
    );

    if (claimError) {
      throw new Error(`Failed to claim tasks: ${claimError.message}`);
    }

    if (!claimedTasks || claimedTasks.length === 0) {
      return NextResponse.json({
        message: "No tasks available",
        tasksProcessed: 0,
        reposUpserted: 0,
        snapshotsUpserted: 0,
        durationMs: Date.now() - startTime,
      });
    }

    const token = requireGitHubToken();

    // Process each task
    for (const task of claimedTasks) {
      try {
        const result = await processTask(task, token);

        totalReposUpserted += result.reposUpserted;
        totalSnapshotsUpserted += result.snapshotsUpserted;
        tasksProcessed++;

        // Update task status
        const newStatus = result.needsSplit ? "needs_split" : result.nextPage === null ? "done" : "in_progress";
        await updateTaskStatus(task.id, newStatus, result.nextPage);
      } catch (error: any) {
        const errorMsg = `Task ${task.id} failed: ${error.message}`;
        errors.push(errorMsg);
        console.error(errorMsg, error);

        // Mark task as in_progress with error (will retry on next run)
        await updateTaskStatus(task.id, "in_progress", task.page, error.message);
      }
    }

    // Log run
    await supabaseServer.from("github_runs").insert({
      endpoint: "github-discover",
      completed_at: new Date().toISOString(),
      tasks_processed: tasksProcessed,
      repos_upserted: totalReposUpserted,
      snapshots_upserted: totalSnapshotsUpserted,
      errors_count: errors.length,
      error_message: errors.length > 0 ? errors.join("; ") : null,
    });

    return NextResponse.json({
      message: "Discovery completed",
      tasksProcessed,
      reposUpserted: totalReposUpserted,
      snapshotsUpserted: totalSnapshotsUpserted,
      errors: errors.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error("Discovery endpoint error:", error);

    // Log failed run
    await supabaseServer.from("github_runs").insert({
      endpoint: "github-discover",
      completed_at: new Date().toISOString(),
      tasks_processed: tasksProcessed,
      repos_upserted: totalReposUpserted,
      snapshots_upserted: totalSnapshotsUpserted,
      errors_count: 1,
      error_message: error.message,
    });

    return NextResponse.json(
      {
        error: error.message,
        tasksProcessed,
        reposUpserted: totalReposUpserted,
        snapshotsUpserted: totalSnapshotsUpserted,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

