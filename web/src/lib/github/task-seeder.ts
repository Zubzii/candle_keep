/**
 * Task Seeder
 * Creates initial github_search_tasks rows using partitioning strategy:
 * - Monthly date windows
 * - Star bands: [100..200], [201..500], [501..1000], [1001..5000], [5001..20000], [20001..∞]
 */

import { supabaseServer } from "@/lib/supabase/server";

export interface SeederConfig {
  createdFrom: string; // YYYY-MM-DD
  pushedAfter?: string; // YYYY-MM-DD
  starsMin: number;
  refreshEveryDays?: number;
}

const DEFAULT_STAR_BANDS = [
  { min: 100, max: 200 },
  { min: 201, max: 500 },
  { min: 501, max: 1000 },
  { min: 1001, max: 5000 },
  { min: 5001, max: 20000 },
  { min: 20001, max: undefined }, // No upper bound
];

/**
 * Generates monthly date windows from start date to today.
 */
function generateMonthlyWindows(startDate: string): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  const start = new Date(startDate);
  const today = new Date();

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= today) {
    const year = current.getFullYear();
    const month = current.getMonth();

    // First day of month
    const from = new Date(year, month, 1);
    // Last day of month
    const to = new Date(year, month + 1, 0);

    // Don't go beyond today
    const windowTo = to > today ? today : to;

    windows.push({
      from: formatDate(from),
      to: formatDate(windowTo),
    });

    // Move to next month
    current = new Date(year, month + 1, 1);
  }

  return windows;
}

/**
 * Formats a Date as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Seeds github_search_tasks table with partitioned queries.
 * Idempotent: checks for existing tasks before inserting.
 */
export async function seedTasks(config: SeederConfig): Promise<{
  created: number;
  skipped: number;
}> {
  const windows = generateMonthlyWindows(config.createdFrom);
  const refreshEveryDays = config.refreshEveryDays || 7;

  let created = 0;
  let skipped = 0;

  // Check existing tasks to avoid duplicates
  const { data: existingTasks } = await supabaseServer
    .from("github_search_tasks")
    .select("created_from, created_to, stars_min, stars_max, pushed_after");

  const existingKeys = new Set(
    (existingTasks || []).map((t) =>
      `${t.created_from}|${t.created_to}|${t.stars_min}|${t.stars_max || "null"}|${t.pushed_after || "null"}`
    )
  );

  // Generate tasks: each window × each star band
  const tasksToInsert: Array<{
    created_from: string;
    created_to: string;
    stars_min: number;
    stars_max: number | null;
    pushed_after: string | null;
    refresh_every_days: number;
    status: string;
  }> = [];

  for (const window of windows) {
    for (const band of DEFAULT_STAR_BANDS) {
      // Skip if stars_min from config is higher than band max
      if (band.max !== undefined && config.starsMin > band.max) {
        continue;
      }

      // Use config.starsMin if it's higher than band min
      const starsMin = Math.max(config.starsMin, band.min);
      const starsMax = band.max || null;

      const key = `${window.from}|${window.to}|${starsMin}|${starsMax || "null"}|${config.pushedAfter || "null"}`;

      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      tasksToInsert.push({
        created_from: window.from,
        created_to: window.to,
        stars_min: starsMin,
        stars_max: starsMax,
        pushed_after: config.pushedAfter || null,
        refresh_every_days: refreshEveryDays,
        status: "ready",
      });
    }
  }

  // Batch insert (Supabase supports up to 1000 rows per insert)
  if (tasksToInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < tasksToInsert.length; i += batchSize) {
      const batch = tasksToInsert.slice(i, i + batchSize);
      const { error } = await supabaseServer
        .from("github_search_tasks")
        .insert(batch);

      if (error) {
        throw new Error(`Failed to insert tasks: ${error.message}`);
      }
      created += batch.length;
    }
  }

  return { created, skipped };
}

/**
 * Gets default seeder config from environment variables.
 */
export function getDefaultSeederConfig(): SeederConfig {
  return {
    createdFrom: process.env.DISCOVERY_CREATED_FROM || "2020-01-01",
    pushedAfter: process.env.DISCOVERY_PUSHED_AFTER || undefined,
    starsMin: parseInt(process.env.DISCOVERY_STARS_MIN || "100", 10),
    refreshEveryDays: 7,
  };
}

