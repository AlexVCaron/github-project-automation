# Setup Guide

## Step 1: Create Your Personal GitHub Project

1. Go to your GitHub profile
2. Click on the **Projects** tab
3. Click **New project**
4. Select **Table** or **Board** layout
5. Name it: `Personal Project Board`
6. Add the following columns:
   - **Backlog** - Issues with no PR and no Stale label
   - **Todo** - Issues without linked PR (non-stale)
   - **Progress** - Open PRs and issues with linked PRs
   - **Review** - Items in review (manual column)
   - **Waiting** - Items marked with Stale label
   - **Done** - Closed/Merged PRs

## Step 2: Get Your Project IDs

### Using GitHub CLI:
```bash
gh project list --owner YOUR_USERNAME --format json
```

### Using GraphQL Explorer:
Go to [GitHub GraphQL Explorer](https://docs.github.com/en/graphql/overview/explorer) and run this query:

```graphql
query {
  user(login: "YOUR_USERNAME") {
    projectsV2(first: 10) {
      nodes {
        id
        number
        title
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
}
```

From the results, extract:
- `projectId` - The full ID (starts with `MDEy`)
- `statusFieldId` - The ID of the Status field
- Column IDs - The option IDs for each column (Backlog, Todo, Progress, Review, Waiting, Done)

## Step 3: Update Configuration

Edit `.github/project-config.json` with your actual IDs:

```json
{
  "projectNumber": YOUR_PROJECT_NUMBER,
  "projectId": "YOUR_PROJECT_ID",
  "statusFieldId": "YOUR_STATUS_FIELD_ID",
  "columns": {
    "backlog": "BACKLOG_OPTION_ID",
    "todo": "TODO_OPTION_ID",
    "progress": "PROGRESS_OPTION_ID",
    "review": "REVIEW_OPTION_ID",
    "waiting": "WAITING_OPTION_ID",
    "done": "DONE_OPTION_ID"
  },
  "labels": {
    "stale": "Stale"
  },
  "automations": {
    "prStateChanges": true,
    "issuePrLinking": true,
    "staleLabelHandler": true,
    "backlogSync": true
  }
}
```

## Step 4: Enable Workflows

The workflows in `.github/workflows/` use the default `GITHUB_TOKEN` which has automatic permissions. No additional setup needed!

Workflows will trigger automatically on:
- PR opens/closes/merges
- Issues labeled/unlabeled
- Hourly schedule for backlog sync

## Step 5: Configure Project Filters

In your GitHub Project settings, configure to include:
- Issues opened by you OR assigned to you
- PRs opened by you OR assigned to you
- Items from all repositories you have access to

## Step 6: Verify Setup

Test your setup:

1. **Create a test issue**
   - Verify it appears in your project's Backlog

2. **Create a test PR**
   - Verify it appears in Progress

3. **Add Stale label to an issue**
   - Verify it moves to Waiting

4. **Link a PR to an issue** (in PR description: "Closes #123")
   - Verify the issue moves to Progress

5. **Merge/Close the PR**
   - Verify it moves to Done

## Troubleshooting

### Items Not Appearing
- Verify project is set to include items from all your repos
- Check that you're the author or assignee of the items
- Ensure the project is correctly configured in `.github/project-config.json`

### Workflows Not Running
- Go to **Actions** tab in your repository
- Check if workflows are enabled
- Look at the workflow logs for error messages

### IDs Not Found
- Use the GraphQL Explorer to verify IDs
- Make sure you're using option IDs, not names
- Confirm IDs start with `MDEy` or similar format

### Items Not Moving
- Verify all IDs in `.github/project-config.json` are correct
- Check Actions logs for GraphQL errors
- Ensure the item is actually in your project before workflows try to move it

## Optional: Cross-Organization Support

To track issues/PRs across multiple organizations:

1. Ensure your personal access token (if used) has access to all organizations
2. Update project filters to include repos from all organizations
3. Workflows will automatically query across all accessible repositories

## Need Help?

- Check the [Automation Guide](automation.md) for detailed workflow explanations
- Review workflow logs in the **Actions** tab
- Verify configuration in `.github/project-config.json`
