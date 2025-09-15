import { populateRepoIdCache, getOctokitForRepo, repoIdCache } from './batchTokenCache.js';

/**
 * This Probot app demonstrates how to handle GitHub App authentication
 * when the app is installed on many repositories 
 * (not all Repos in an organization), potentially exceeding
 * the 500-repo limit for a single access token.
 */
export default (app) => {
  // Pre-populate repo ID caches for all current installations at startup
  (async () => {
    try {
      await populateRepoIdCache(app);
      // Print out the cache after population
      console.log('[repoIdCache] Populated cache:', repoIdCache);
    } catch (err) {
      app.log.warn('Failed to prepopulate repo ID caches at startup', err);
    }
  })();

  // Example usage: handle an issue opened event
  app.on("issues.opened", async (context) => {
    // For the event repo, post a comment using the event context
    const repoFullName = context.payload.repository.full_name;
    const octokit = await getOctokitForRepo(app, repoFullName);
    const { owner, repo, issue_number } = context.issue();
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number,
      body: `This repository is managed by our GitHub App, which supports organizations exceeding the 500-repo-token limit.`,
    });
  });

  app.on("issue_comment.created", async (context) => {
    app.log.info(`Comment received: ${context.payload.comment.body}`);
    // Example: Read a custom property from all repos registered with the app
    for (const repoFullName of Object.keys(repoIdCache)) {
      // This will automatically use the correct batch token for each repo
      const octokit = await getOctokitForRepo(app, repoFullName);

      const [owner, repo] = repoFullName.split('/');
      const repoData = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });

      // Demo: always log a property that exists and is not redundant, e.g. stargazers_count
      console.log(`${repoFullName} stars:`, repoData.data.stargazers_count);
    }
  });
};
