/**
 * GitHub API Client
 * Handles search queries with rate limiting, backoff, and query building.
 */

export interface GitHubSearchParams {
  createdFrom: string; // YYYY-MM-DD
  createdTo: string; // YYYY-MM-DD
  starsMin: number;
  starsMax?: number; // Optional upper bound
  pushedAfter?: string; // YYYY-MM-DD
  page?: number;
  perPage?: number;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  url: string; // API URL
  owner: {
    login: string;
    type: string;
  };
  description: string | null;
  language: string | null;
  fork: boolean;
  archived: boolean;
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
}

export interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
}

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_DELAY_MS = parseInt(process.env.GITHUB_SEARCH_DELAY_MS || "2100", 10);

/**
 * Builds a GitHub Search API query string from parameters.
 */
export function buildSearchQuery(params: GitHubSearchParams): string {
  const parts: string[] = [];

  // Date range: created:YYYY-MM-DD..YYYY-MM-DD
  parts.push(`created:${params.createdFrom}..${params.createdTo}`);

  // Stars filter
  if (params.starsMax !== undefined) {
    parts.push(`stars:${params.starsMin}..${params.starsMax}`);
  } else {
    parts.push(`stars:>=${params.starsMin}`);
  }

  // Pushed after filter
  if (params.pushedAfter) {
    parts.push(`pushed:>${params.pushedAfter}`);
  }

  // Always include these filters
  parts.push("is:public");
  parts.push("archived:false");

  return parts.join(" ");
}

/**
 * Sleep utility for rate limiting.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a page of GitHub search results with rate limiting and backoff.
 */
export async function searchRepositories(
  params: GitHubSearchParams,
  token: string
): Promise<GitHubSearchResponse> {
  const query = buildSearchQuery(params);
  const page = params.page || 1;
  const perPage = params.perPage || 100;

  const url = new URL(`${GITHUB_API_BASE}/search/repositories`);
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", perPage.toString());
  url.searchParams.set("page", page.toString());

  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    try {
      // Rate limiting: wait before request (except first attempt)
      if (attempt > 0) {
        await sleep(DEFAULT_DELAY_MS);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      // Handle rate limit errors
      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitSeconds = retryAfter
          ? parseInt(retryAfter, 10)
          : Math.pow(2, attempt) * 2; // Exponential backoff: 2s, 4s, 8s, 16s, 32s

        console.warn(
          `GitHub rate limit hit. Waiting ${waitSeconds}s before retry ${attempt + 1}/${maxAttempts}`
        );
        await sleep(waitSeconds * 1000);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `GitHub API error ${response.status}: ${errorText}`
        );
      }

      const data: GitHubSearchResponse = await response.json();

      // Small delay after successful request to respect rate limits
      if (attempt === 0) {
        await sleep(DEFAULT_DELAY_MS);
      }

      return data;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      attempt++;
      // Exponential backoff on network errors
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw new Error("Max retry attempts reached");
}

/**
 * Validates that a GitHub token is set.
 */
export function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required. " +
      "Create a Personal Access Token at https://github.com/settings/tokens"
    );
  }
  return token;
}

