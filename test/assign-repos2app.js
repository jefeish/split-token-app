/**
 * Run: TOKEN=your_token node test/assign-repos2app.js 123456 987654321 123123123
 * jefeish-split-token-app: 86253294
 */
import { Octokit } from "octokit";

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const octokit = new Octokit({ auth: TOKEN });

// Global repo name -> id map
let globalRepoMap = new Map();

async function addReposToAppInstallation(installationId, repoIds) {
  // repoIds: array of repository IDs to add
  for (const repoId of repoIds) {
    // Lookup repo name from globalRepoMap
    let repoName = null;
    for (const [name, id] of globalRepoMap.entries()) {
      if (id === repoId) {
        repoName = name;
        break;
      }
    }
    if (repoName) {
      console.log(`Assigning ${repoName} (${repoId}) to installation ${installationId}`);
    } else {
      console.log(`Assigning repoId ${repoId} to installation ${installationId}`);
    }
    await octokit.request(
      "PUT /user/installations/{installation_id}/repositories/{repository_id}",
      {
        installation_id: installationId,
        repository_id: repoId,
      }
    );
    if (repoName) {
      console.log(`Added repo ${repoName} (${repoId}) to installation ${installationId}`);
    } else {
      console.log(`Added repoId ${repoId} to installation ${installationId}`);
    }
  }
}

/**
 * @description Cache all repos in a GitHub organization and return a map of repo name to id
 * @param {string} orgName
 * @returns {Promise<Map<string, number>>}
 */
async function cacheReposForOrg(orgName) {
  console.log(`Fetching all repos for org ${orgName}...`);
  let repos = [];
  let page = 1;
  const per_page = 100;
  while (true) {
    const resp = await octokit.request("GET /orgs/{org}/repos", {
      org: orgName,
      per_page,
      page,
    });
    repos = repos.concat(resp.data);
    if (resp.data.length < per_page) break;
    page++;
  }
  const repoMap = new Map();
  for (const repo of repos) {
    repoMap.set(repo.name, repo.id);
  }
  globalRepoMap = repoMap;

  // JSON formatted with: name:<repo_name>, id:<repo_id>
  console.log(JSON.stringify(Array.from(repoMap.entries()).map(([name, id]) => ({ name, id })), null, 2));
  return repoMap;
}

// Parse input parameters
const [,, ...args] = process.argv;

function parseArg(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

if (args[0] === "--org" && args[1]) {
  const orgName = args[1];
  (async () => {
    const repoMap = await cacheReposForOrg(orgName);
    const installationId = parseArg('--installation-id');
    const reposArg = parseArg('--repo-ids');
    const rangeArg = parseArg('--range');
    if (installationId) {
      let repoIds = [];
      if (reposArg) {
        // --repo-ids 123,456,789
        repoIds = reposArg.split(',').map(Number);
      } else if (rangeArg) {
        // --range 0,10
        const [start, end] = rangeArg.split(',').map(Number);
        const allIds = Array.from(repoMap.values());
        repoIds = allIds.slice(start, end + 1);
      }
      if (repoIds.length > 0) {
        await addReposToAppInstallation(Number(installationId), repoIds);
      } else {
        console.log('No repo IDs provided for assignment.');
      }
    }
  })().catch(err => {
    console.error("Failed to process org repos:", err.message);
    process.exit(1);
  });
} else if (args[0]) {
  const installationId = Number(args[0]);
  const repoIds = args.slice(1).map(Number);
  (async () => {
    if (repoIds.length > 0) {
      await addReposToAppInstallation(Number(installationId), repoIds);
    }
    // No more dumpReposForInstallation
  })();
} else {
  console.log("Usage: \n node test/assign-repos2app.js --org jefeish-test --installation-id 123456 --repo-ids 111,222,333 \n node test/assign-repos2app.js --org jefeish-test --installation-id 123456 --range 0,9");
  console.log("\n When you use --org <orgName> --installation-id <id> --range <start,end>, \n the script:\n"+ 
  "   1. Caches all repos in the org (using cacheReposForOrg), which returns a map of repo name to ID.\n"+
  "   2. Converts the map values (repo IDs) to an array.\n"+
  "   3. Selects the IDs from index start to end (inclusive).\n"+
  "   4. Assigns those repos to the specified installation.")
  process.exit(1);

}