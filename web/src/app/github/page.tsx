"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Force dynamic rendering
export const dynamic = "force-dynamic";

type RepoTrend = {
  repo_id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stars_now: number;
  abs_growth_14d: number | null;
  pct_growth_14d: number | null;
  score: number | null;
  is_new: boolean;
  computed_at: string;
};

export default function GitHubPage() {
  const [trends, setTrends] = useState<RepoTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSmall, setFilterSmall] = useState(true);
  const [minGrowth, setMinGrowth] = useState(20);

  useEffect(() => {
    loadTrends();
  }, [filterSmall, minGrowth]);

  async function loadTrends() {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("github_repo_trends")
        .select(
          `
          repo_id,
          stars_now,
          abs_growth_14d,
          pct_growth_14d,
          score,
          is_new,
          computed_at,
          github_repos!inner (
            full_name,
            html_url,
            description,
            language
          )
        `
        )
        .order("score", { ascending: false, nullsFirst: false })
        .limit(200);

      // Apply filters
      if (filterSmall) {
        query = query.lte("stars_now", 2000);
      }
      if (minGrowth > 0) {
        query = query.gte("abs_growth_14d", minGrowth);
      }

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      // Transform data to flatten github_repos relation
      const transformed =
        data?.map((item: any) => ({
          repo_id: item.repo_id,
          full_name: item.github_repos.full_name,
          html_url: item.github_repos.html_url,
          description: item.github_repos.description,
          language: item.github_repos.language,
          stars_now: item.stars_now,
          abs_growth_14d: item.abs_growth_14d,
          pct_growth_14d: item.pct_growth_14d,
          score: item.score,
          is_new: item.is_new,
          computed_at: item.computed_at,
        })) || [];

      setTrends(transformed);
    } catch (err: any) {
      setError(err.message);
      console.error("Failed to load trends:", err);
    } finally {
      setLoading(false);
    }
  }

  function formatPercent(value: number | null): string {
    if (value === null) return "—";
    return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  }

  function formatNumber(value: number | null): string {
    if (value === null) return "—";
    return value >= 0 ? `+${value}` : `${value}`;
  }

  return (
    <main className="dash">
      <header className="nav">
        <div className="nav-inner">
          <Link className="nav-brand" href="/" aria-label="Candle Keep">
            <span className="candle nav-icon" aria-hidden="true">
              <span className="candle-flame" />
              <span className="candle-body" />
            </span>
            <span className="nav-title">Candle Keep</span>
          </Link>
          <nav className="nav-tabs" aria-label="Navigation">
            <Link className="tab" href="/home">
              Home
            </Link>
            <Link className="tab active" href="/github">
              GitHub
            </Link>
          </nav>
        </div>
      </header>

      <div className="dash-top">
        <div className="dash-brand" aria-label="GitHub Trends">
          <span className="candle dash-icon" aria-hidden="true">
            <span className="candle-flame" />
            <span className="candle-body" />
          </span>
          <div>
            <div className="dash-title">GitHub Trends</div>
            <div className="dash-subtitle">
              Small repos growing quickly (14-day growth metrics)
            </div>
          </div>
        </div>
        <Link className="chip" href="/">
          Back to Login
        </Link>
      </div>

      <div style={{ marginBottom: "20px", display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={filterSmall}
            onChange={(e) => setFilterSmall(e.target.checked)}
          />
          <span>Small repos only (≤2000 stars)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Min growth:</span>
          <input
            type="number"
            value={minGrowth}
            onChange={(e) => setMinGrowth(parseInt(e.target.value) || 0)}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              background: "rgba(0, 0, 0, 0.25)",
              border: "1px solid rgba(255, 255, 255, 0.10)",
              color: "var(--text)",
              width: "80px",
            }}
          />
        </label>
        <button
          onClick={loadTrends}
          style={{
            padding: "8px 12px",
            borderRadius: "10px",
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(255, 255, 255, 0.10)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ padding: "20px", textAlign: "center" }}>Loading trends...</div>}
      {error && (
        <div style={{ padding: "20px", color: "var(--accent)", textAlign: "center" }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && trends.length === 0 && (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)" }}>
          No trends found. Run the discovery cron to populate data.
        </div>
      )}

      {!loading && !error && trends.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="GitHub Trends table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Language</th>
                <th>Stars Now</th>
                <th>14d Growth</th>
                <th>14d %</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((trend) => (
                <tr key={trend.repo_id}>
                  <td className="strong">
                    <a
                      href={trend.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      {trend.full_name}
                    </a>
                    {trend.description && (
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                        {trend.description}
                      </div>
                    )}
                  </td>
                  <td>{trend.language || "—"}</td>
                  <td>{trend.stars_now.toLocaleString()}</td>
                  <td>{formatNumber(trend.abs_growth_14d)}</td>
                  <td>{formatPercent(trend.pct_growth_14d)}</td>
                  <td>{trend.score?.toFixed(1) || "—"}</td>
                  <td>
                    {trend.is_new ? (
                      <span style={{ fontSize: "11px", color: "var(--accent2)" }}>New</span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>Growing</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

