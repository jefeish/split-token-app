

// Import functions for caching and token batching logic
import { populateRepoCache, repoCache } from './tokenBatcher.js';
import fs from 'fs';
// Import function to get a GitHub App installation access token
import { getAccessToken } from './getAppInstallationToken.js';

/**
 * Probot app entry point for handling GitHub App authentication and token batching.
 * This app demonstrates how to manage installations that may exceed the 500-repo limit for a single access token.
 *
 * Main responsibilities:
 *   - Pre-populate a cache of all repositories for current installations at startup
 *   - Generate access tokens for all repos, subsets, and individual repos
 *   - Handle GitHub webhook events (e.g., issues.opened)
 */
export default (app) => {
  // At startup, pre-populate the repo ID cache for all current installations
  (async () => {
    try {
      // Populate the repo cache by querying all installations
      app.log.info('Caching all repositories for current installations...');
      repoCache = await populateRepoCache(app);
      app.log.debug(`repoCache: \n ${JSON.stringify(repoCache, null, 2)}`);
    } catch (err) {
      // Log if the cache population fails
      app.log.error('Failed to populate repo cache', err);
    }

    try {
      // Attempt to generate a token for all repos in the installation
      app.log.info(`Get token for all repos in the installation [${Object.keys(repoCache).length}]...`);
      // Read app credentials from environment variables
      const clientId = process.env.APP_ID;
      const privatePem = process.env.PRIVATE_KEY;
      if (!clientId || !privatePem) {
        app.log.error('Missing APP_ID or PRIVATE_KEY when attempting to get repo access token');
        return;
      }
      if (!repoCache || Object.keys(repoCache).length === 0) {
        app.log.error('repoCache is empty; cannot build repo list');
        return;
      }
      // Use the first repo's installationId as a demonstration
      const firstEntry = Object.values(repoCache)[0];
      const installationId = firstEntry && firstEntry.installationId;
      if (!installationId) {
        app.log.error('Could not determine installationId from repoCache');
        return;
      }
      // Build a list of all repo names for this installation
      const allReposForInstallation = Object.keys(repoCache)
        .filter(r => repoCache[r].installationId === installationId)
        .map(r => r.split('/')[1]);
      app.log.debug(`allReposForInstallation: \n ${JSON.stringify(allReposForInstallation, null, 2)}`);

      const repositories = allReposForInstallation;
      // Set the permissions for the token
      const permissions = { contents: 'read', issues: 'write' };
      app.log.debug(`All repos for installation ${installationId}, [num of repos:${repositories.length}] : ${repositories}`);
      try {
        // Generate a token for all repos in the installation
        const tokenResp = await getAccessToken({ clientId, privatePem, installationId, repositories, permissions });
        // tokenResp includes token + metadata (expires_at, permissions, repositories, etc.)
        app.log.info(`Successfully generated batch token for installation ${installationId}. Repo count: ${repositories.length}. Expires at: ${tokenResp.expires_at}`);
      } catch (innerErr) {
        // Log details if token generation fails
        if (innerErr.response) {
          app.log.error(`GitHub API error generating repo access token: status=${innerErr.response.status} message=${innerErr.response.data?.message}`);
          app.log.debug(`Response headers: ${JSON.stringify(innerErr.response.headers, null, 2)}`);
          app.log.debug(`Response data: ${JSON.stringify(innerErr.response.data, null, 2)}`);
        } else if (innerErr.request) {
          app.log.error('Network error generating repo access token (no response received)');
        } else {
          app.log.error(`Error generating repo access token: ${innerErr.message}`);
        }
        app.log.debug(innerErr.stack);
        // throw innerErr; // allow outer catch to record generic failure message too
      }

      try {
        // Generate a token for a subset of repos (first 500)
        const repo_subset = repositories.slice(0, 500);
        const tokenResp = await getAccessToken({ clientId, privatePem, installationId, repositories: repo_subset, permissions });
        app.log.info(`Successfully generated batch token for installation ${installationId}. Repo count: ${repo_subset.length}. Expires at: ${tokenResp.expires_at}`);
      } catch (innerErr) {
        app.log.error('Error generating batch token for subset of repos', innerErr);
      }

      try {
        // Generate a token for each repo individually (demonstrates per-repo tokens)
        const tokens = []
        for (const repoFullName of Object.keys(repoCache)) {
          app.log.info(`Generating individual token for repo ${repoFullName}...`);
          const repoName = repoFullName.split('/')[1];
          tokens.push(await getAccessToken({ clientId, privatePem, installationId, repositories: [repoName], permissions }));
          app.log.info(`Token for repo ${repoFullName}: ${tokens[tokens.length - 1].token} -  Expires at: ${tokens[tokens.length - 1].expires_at}`); // Log the actual token
        }
        app.log.info(`Successfully generated ${tokens.length} individual repo tokens for installation ${installationId}.`);
      } catch (innerErr) {
        // Log details if any individual token generation fails
        if (innerErr.response) {
          app.log.error(`GitHub API error generating repo access token: status=${innerErr.response.status} message=${innerErr.response.data?.message}`);
          app.log.debug(`Response headers: ${JSON.stringify(innerErr.response.headers, null, 2)}`);
          app.log.debug(`Response data: ${JSON.stringify(innerErr.response.data, null, 2)}`);
        } else if (innerErr.request) {
          app.log.error('Network error generating repo access token (no response received)');
        } else {
          app.log.error(`Error generating repo access token: ${innerErr.message}`);
        }
        app.log.debug(innerErr.stack);
        // throw innerErr; // allow outer catch to record generic failure message too
      }
    } catch (err) {
      // Log if token generation for repos fails
      app.log.error('Failed to generate tokens for repos in installation', err);
    }
  })();

  // Handle the 'issues.opened' webhook event
  app.on("issues.opened", async (context) => {
    // Extract the repo full name from the event payload
    const repoFullName = context.payload.repository.full_name;
    // Get an authenticated Octokit instance for this repo
    const octokit = await getOctokitForRepo(app, repoFullName);
    // Extract owner, repo, and issue number from the event context
    const { owner, repo, issue_number } = context.issue();
    // Post a comment to the newly opened issue
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number,
      body: `This repository is managed by our GitHub App, which supports organizations exceeding the 500-repo-token limit.`,
    });
  });
};
