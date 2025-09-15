# split-token-app

> A GitHub App built with [Probot](https://github.com/probot/probot) that A Probot app

---

## Requirements for a robust solution to the GitHub 500-repo token limit:

### Summary of requirements:

1. You need a list of all repos registered with the app, including their repo_id and installation_id.
1. For each installation, if there are more than 500 repos, split them into batches of 500.
1. For each batch, create a batch token (installation access token) and associate it with all repos in that batch.
1. When making an API call for a repo, use the batch token for its batch.
1. Cache batch tokens and associate them with their batch of repos.
1. When a token is requested for a repo, return the cached token if it is still valid (not expired).
1. If the token is expired (older than 60 minutes), create a new token for the batch, update the cache, and use it for subsequent calls.

### Implementation notes:

- You need a cache structure that maps batch (or repo ID) to its current token and the token’s expiration time.
- On each API call, check the cache for the batch token:
  - If the token is present and not expired, use it.
  - If not, request a new token, cache it with its expiration, and use it.
- This logic can be wrapped in a helper or middleware so developers don’t need to manage tokens manually.

![diagram](diagram.svg)

### Utility module: `batchTokenCache`

#### Sample

Sample usage that demonstrates how to transparently access all repositories (even if you have more than 500) using the `getOctokitForRepo` helper from batchTokenCache.js

```node
import { getOctokitForRepo } from './batchTokenCache.js';
...
// Example: Read a custom property from all repos registered with the app
for (const [repoFullName] of Object.entries(repoIdCache)) {
  // This will automatically use the correct batch token for each repo
  const octokit = await getOctokitForRepo(app, repoFullName);

  const [owner, repo] = repoFullName.split('/');
  const repoData = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });

  // Access your custom property, e.g. repoData.data.custom_property
  console.log(`${repoFullName}:`, repoData.data.custom_property);
}
```

---

## Contributing

If you have suggestions for how split-token-app could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2025 Jürgen Efeish
