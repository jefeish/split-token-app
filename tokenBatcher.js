/**
 * tokenBatcher.js
 * Utilities to split large repository lists into 500‑repo batches (GitHub installation access token limit)
 * and request scoped tokens for a specific batch.
 */
import { getAccessToken } from './getAppInstallationToken.js';

// Shared in-memory cache of repositories keyed by full_name => { id, installationId }
// Populated by populateRepoCache(app). Exported so other modules can read current mapping.
export const repoCache = {};

/**
 * Populate the repoCache with all repos for all installations.
 * NOTE: This will clear and rebuild the cache each time it's called.
 * @param {*} app - The GitHub App instance.
 * @returns {Promise<object>} repoCache mapping
 */
export async function populateRepoCache(app) {
  // Clear existing keys without changing reference (so existing imports see updates)
  for (const k of Object.keys(repoCache)) delete repoCache[k];

  const appAuth = await app.auth();
  const installations = await appAuth.paginate("GET /app/installations");
  for (const inst of installations) {
    const installationOctokit = await app.auth(inst.id);
    const repoList = await installationOctokit.paginate("GET /installation/repositories");
    for (const repo of repoList) {
      repoCache[repo.full_name] = { id: repo.id, installationId: inst.id };
    }
  }
  app.log.debug(`[tokenBatcher] Cached ${Object.keys(repoCache).length} repos total.`);
  return repoCache;
}

/**
 * Chunk an array into equally sized pieces (last one may be smaller).
 * @param {string[]} items
 * @param {number} size
 * @returns {string[][]}
 */
export function chunk(items, size = 500) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Derive canonical, stable list of repository names for a given installation from repoCache.
 * @param {object} repoCache - Map of repoFullName -> { installationId, repoId, ... }
 * @param {number|string} installationId
 * @returns {string[]} Sorted repository names (no owner, just repo)
 */
export function listReposForInstallation(repoCache, installationId) {
  if (!repoCache) return [];
  const repos = Object.keys(repoCache)
    .filter(full => repoCache[full].installationId === installationId)
    .map(full => full.split('/')[1]);
  // Stable ordering so batch index is consistent across runs
  return repos.sort((a, b) => a.localeCompare(b));
}

/**
 * Get repositories for a particular batch index.
 * @param {string[]} sortedRepos - canonical sorted repo name list
 * @param {number} batchIndex - 0-based batch index
 * @param {number} batchSize - default 500
 * @returns {string[]} subset for that batch (could be empty if out of range)
 */
export function reposForBatch(sortedRepos, batchIndex = 0, batchSize = 500) {
  if (batchIndex < 0) throw new Error('batchIndex must be >= 0');
  return sortedRepos.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
}

/**
 * Request an installation access token scoped to exactly the repos in the batch (<= 500).
 * @param {object} params
 * @param {string|number} params.clientId
 * @param {string} params.privatePem
 * @param {string|number} params.installationId
 * @param {string[]} params.repositories
 * @param {object} [params.permissions]
 * @returns {Promise<object>} token response payload from GitHub (includes token, expires_at, permissions, repositories)
 */
export async function getBatchToken({ clientId, privatePem, installationId, repositories, permissions }) {
  if (!repositories || repositories.length === 0) {
    throw new Error('No repositories provided for batch token');
  }
  if (repositories.length > 500) {
    throw new Error(`Batch exceeds 500 repos (got ${repositories.length})`);
  }
  return await getAccessToken({ clientId, privatePem, installationId, repositories, permissions });
}

/**
 * Convenience to get tokens for all batches (be careful with rate limits).
 * @param {object} params
 * @param {string|number} params.clientId
 * @param {string} params.privatePem
 * @param {string|number} params.installationId
 * @param {string[]} params.sortedRepos
 * @param {object} [params.permissions]
 * @returns {Promise<object[]>} array of token response payloads, index aligned with batch index.
 */
export async function getAllBatchTokens({ clientId, privatePem, installationId, sortedRepos, permissions }) {
  const batches = chunk(sortedRepos, 500);
  const out = [];
  for (let i = 0; i < batches.length; i++) {
    const subset = batches[i];
    // eslint-disable-next-line no-await-in-loop
    const token = await getBatchToken({ clientId, privatePem, installationId, repositories: subset, permissions });
    out.push({ batchIndex: i, size: subset.length, ...token });
  }
  return out;
}
