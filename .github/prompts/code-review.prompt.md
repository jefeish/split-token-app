---
mode: agent
description: "Comprehensive code review for split-token-app"
---

# Code Review Prompt

Review the provided code changes with focus on:

## Security Analysis
- Check for exposed secrets, API keys, or sensitive data
- Validate input sanitization and authentication flows
- Review token handling and storage practices

## Code Quality
- Assess readability, maintainability, and structure
- Check for proper error handling
- Validate logging and debugging practices

## GitHub App Best Practices
- Review Probot app patterns and conventions
- Check webhook handling and event processing
- Validate GitHub API usage and rate limiting

## Project-Specific Context
This is a GitHub App that demonstrates token batching for installations with 500+ repositories. Pay special attention to:
- Token caching and expiration logic
- Batch processing implementation
- Repository access patterns

## Output Format
Provide:
1. **Summary**: Brief overview of changes
2. **Issues Found**: List any problems with severity levels
3. **Suggestions**: Concrete improvement recommendations
4. **Approval Status**: Ready to push, needs changes, or requires discussion