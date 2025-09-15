import { Octokit } from 'octokit';
const BATCH_SIZE = 500; // for testing, set to 5 or 10
const TOKEN_EXPIRY = 60 * 60 * 1000; // 60 minutes

// Self-contained repoIdCache and initialization
const repoIdCache = {};

/**
 * Populate the repoIdCache with all repos for all installations.
 * @param {*} app - The GitHub App instance.
 */
export async function populateRepoIdCache(app) {
  // Get an Octokit instance authenticated as the app
  const appAuth = await app.auth();

  // Paginate all installations available to the app
  const installations = await appAuth.paginate("GET /app/installations");

  // Build a key/value object keyed by full_name (owner/repo), value is { id, installationId }
  for (const inst of installations) {
    const installationOctokit = await app.auth(inst.id);
    const repoList = await installationOctokit.paginate("GET /installation/repositories");
    for (const repo of repoList) {
      repoIdCache[repo.full_name] = { id: repo.id, installationId: inst.id };
    }
  }

  // Log all cached repos (fixed-width columns)
  const nameCol = 40;
  const idCol = 10;
  for (const [name, info] of Object.entries(repoIdCache)) {
    const shortName = name.length > nameCol ? `${name.slice(0, nameCol - 3)}...` : name;
    const namePadded = shortName.padEnd(nameCol);
    const idPadded = String(info.id).padStart(idCol);
    app.log.info(`Cached repo: ${namePadded} repo_id:${idPadded} installation:${info.installationId}`);
  }
  app.log.info(`Cached ${Object.keys(repoIdCache).length} repos total.`);
}

/**
 * return a distinguished list of all installation IDs known in the repoIdCache.
 * @returns {number[]} - Array of installation IDs
 */
// getAllInstallationIds is now internal
function getAllInstallationIds() {
  const installationIds = new Set();
  for (const info of Object.values(repoIdCache)) {
    installationIds.add(info.installationId);
  }
  return Array.from(installationIds);
}

const batchTokenCache = {};

function getInstallationIdForRepo(repoFullName) {
  const info = repoIdCache[repoFullName];
  if (!info) throw new Error(`Repo info not found for ${repoFullName}`);
  return info.installationId;
}

function getBatchForRepoName(installationId, repoFullName) {
  const repoIds = Object.values(repoIdCache)
    .filter(info => info.installationId === installationId)
    .map(info => info.id);
  const batches = [];
  for (let i = 0; i < repoIds.length; i += BATCH_SIZE) {
    batches.push(repoIds.slice(i, i + BATCH_SIZE));
  }
  const repoId = repoIdCache[repoFullName]?.id;
  if (!repoId) throw new Error(`Repo info not found for ${repoFullName}`);
  for (const batch of batches) {
    if (batch.includes(repoId)) return batch;
  }
  throw new Error('Repo ID not found in any batch');
}

function getBatchIndexForRepoName(installationId, repoFullName) {
  const repoIds = Object.values(repoIdCache)
    .filter(info => info.installationId === installationId)
    .map(info => info.id);
  const repoId = repoIdCache[repoFullName]?.id;
  if (!repoId) throw new Error(`Repo info not found for ${repoFullName}`);
  for (let i = 0; i < repoIds.length; i += BATCH_SIZE) {
    const batch = repoIds.slice(i, i + BATCH_SIZE);
    if (batch.includes(repoId)) return i / BATCH_SIZE;
  }
  throw new Error('Repo ID not found in any batch');
}

async function getBatchTokenForRepo(app, repoFullName) {
  const installationId = getInstallationIdForRepo(repoFullName);
  if (!batchTokenCache[installationId]) batchTokenCache[installationId] = [];
  const batchIndex = getBatchIndexForRepoName(installationId, repoFullName);
  let batchEntry = batchTokenCache[installationId][batchIndex];
  const batch = getBatchForRepoName(installationId, repoFullName);

  // Check if token exists and is not expired
  if (batchEntry && batchEntry.token && batchEntry.expiresAt > new Date()) {
    console.log(`[batchTokenCache] Cache hit for repo '${repoFullName}' (installation ${installationId}, batch ${batchIndex})`);
    return batchEntry.token;
  }

  console.log(`[batchTokenCache] Cache miss or expired token for repo '${repoFullName}' (installation ${installationId}, batch ${batchIndex}). Requesting new token...`);

  const appAuth = await app.auth();
  const { data: tokenData } = await appAuth.request(
    'POST /app/installations/{installation_id}/access_tokens',
    {
      installation_id: installationId,
      repository_ids: batch,
    }
  );
  // Token expires in TOKEN_EXPIRY ms
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY);
  batchEntry = { batch, token: tokenData.token, expiresAt };
  batchTokenCache[installationId][batchIndex] = batchEntry;
  console.log(`[batchTokenCache] New token cached for installation ${installationId}, batch ${batchIndex}. Expires at ${expiresAt.toISOString()}`);
  return tokenData.token;
}

/**
 * Get a GitHub App Octokit instance for a specific repository.
 * @param {*} app - The GitHub App instance.
 * @param {*} repoFullName - The full name of the repository (owner/repo).
 * @returns {Promise<Octokit>} - The Octokit instance for the repository.
 */
export async function getOctokitForRepo(app, repoFullName) {
  app.log.info(`Getting Octokit for repo: ${repoFullName}`);
  const token = await getBatchTokenForRepo(app, repoFullName);
  app.log.info(`Obtained token for repo: ${repoFullName}`);
  return new Octokit({ auth: token });
}

// Optionally export repoIdCache if you need to inspect it externally
export { repoIdCache };
