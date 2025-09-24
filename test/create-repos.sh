#!/bin/bash

ORG="jefeish-test"         # Set your organization name here
PREFIX="repo"              # Repo name prefix
COUNT=555                   # Number of repos to create
START_NUM=1                # Starting number for repo numbering
THROTTLE=1                  # Seconds to wait between creations (set to 0 for no throttle)
GITHUB_PAT="..."            # Set your GitHub Personal Access Token here
DRY_RUN=0                   # Set to 1 for dry-run (no API calls)

API_URL="https://api.github.com/orgs/$ORG/repos"

for i in $(seq $START_NUM $COUNT + 1); do
  PADDED_NUM=$(printf "%03d" "$i")
  REPO_NAME="${PREFIX}-${PADDED_NUM}"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY RUN] Would create $ORG/$REPO_NAME, with description: Test repo $REPO_NAME created by script"
  else
    echo "Creating $ORG/$REPO_NAME..."
    # Capture both headers and body
    RESPONSE=$(mktemp)
    HEADERS=$(mktemp)
    STATUS=$(curl -s -w "%{http_code}" -o "$RESPONSE" -D "$HEADERS" -X POST "$API_URL" \
      -H "Authorization: token $GITHUB_PAT" \
      -H "Accept: application/vnd.github+json" \
      -d '{
        "name": "'$REPO_NAME'",
        "visibility": "internal",
        "auto_init": true,
        "description": "Test repo, '" $REPO_NAME "' created by script"
      }')
    if [ "$STATUS" = "403" ]; then
      echo "Received 403 Forbidden for $REPO_NAME."

      # Extract x-ratelimit-reset and print next allowed time
      RESET=$(grep -i '^x-ratelimit-reset:' "$HEADERS" | awk '{print $2}' | tr -d '\r')
      if [ -n "$RESET" ]; then
        echo "Rate limit resets at (UTC): $(date -u -r $RESET)"
        echo "Rate limit resets at (EST): $(TZ=America/New_York date -r $RESET)"
      fi
      cat "$RESPONSE"
      rm -f "$RESPONSE" "$HEADERS"
      exit 1
    fi
    rm -f "$RESPONSE" "$HEADERS"
    if [ "$THROTTLE" -gt 0 ]; then
      sleep $THROTTLE
    fi
  fi
done

echo "Done."