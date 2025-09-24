
import { populateRepoCache, repoCache } from './tokenBatcher.js';
import fs from 'fs';
import { getAccessToken } from './getAppInstallationToken.js';

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
      app.log.info('Caching all repositories for current installations...');
      repoCache = await populateRepoCache(app);
      app.log.debug(`repoCache: \n ${JSON.stringify(repoCache, null, 2)}`);
    } catch (err) {
      app.log.error('Failed to populate repo cache', err);
    }

    try {
      app.log.info(`Get token for all repos in the installation [${Object.keys(repoCache).length}]...`);
      // Access previously hoisted env vars
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
      // derive an installationId from the first cache entry (learning/demo purpose)
      const firstEntry = Object.values(repoCache)[0];
      const installationId = firstEntry && firstEntry.installationId;
      if (!installationId) {
        app.log.error('Could not determine installationId from repoCache');
        return;
      }
      const allReposForInstallation = Object.keys(repoCache)
        .filter(r => repoCache[r].installationId === installationId)
        .map(r => r.split('/')[1]);
      app.log.debug(`allReposForInstallation: \n ${JSON.stringify(allReposForInstallation, null, 2)}`);

      const repositories = allReposForInstallation;
      const permissions = { contents: 'read', issues: 'write' };
      app.log.debug(`All repos for installation ${installationId}, [num of repos:${repositories.length}] : ${repositories}`);
      try {
        const tokenResp = await getAccessToken({ clientId, privatePem, installationId, repositories, permissions });
        // tokenResp includes token + metadata (expires_at, permissions, repositories, etc.)
        app.log.info(`Successfully generated batch token for installation ${installationId}. Repo count: ${repositories.length}. Expires at: ${tokenResp.expires_at}`);
      } catch (innerErr) {
        // Provide detailed diagnostics
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
        const repo_subset = repositories.slice(0, 500);
        const tokenResp = await getAccessToken({ clientId, privatePem, installationId, repositories: repo_subset, permissions });
        app.log.info(`Successfully generated batch token for installation ${installationId}. Repo count: ${repo_subset.length}. Expires at: ${tokenResp.expires_at}`);
      } catch (innerErr) {
        app.log.error('Error generating batch token for subset of repos', innerErr);
      }

      try {
        // create a token for each repo to demonstrate per-repo 'accessTokens'
        const tokens = []
        for (const repoFullName of Object.keys(repoCache)) {
          app.log.info(`Generating individual token for repo ${repoFullName}...`);
          const repoName = repoFullName.split('/')[1];
          tokens.push(await getAccessToken({ clientId, privatePem, installationId, repositories: [repoName], permissions }));
          app.log.info(`Token for repo ${repoFullName}: ${tokens[tokens.length - 1].token} -  Expires at: ${tokens[tokens.length - 1].expires_at}`); // Log the actual token
        }
        app.log.info(`Successfully generated ${tokens.length} individual repo tokens for installation ${installationId}.`);
      } catch (innerErr) {
        // Provide detailed diagnostics
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
      app.log.error('Failed to generate tokens for repos in installation', err);
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
};
