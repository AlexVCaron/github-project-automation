# Automation Documentation

## Overview

This project uses GitHub Actions workflows to automatically manage your personal GitHub Project Board. The system intelligently moves issues and PRs between columns based on their state, labels, and relationships.

## Workflows

### 1. PR State Changes (`pr-state-changes.yml`)

**Trigger:** When a PR is opened, reopened, closed, or synchronized

**Logic:**
- **PR opened or reopened** → Move to **Progress**
- **PR closed or merged** → Move to **Done**

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column IDs for `progress` and `done`

### 2. Issue-PR Link Detection (`issue-pr-link.yml`)

**Trigger:** When a PR is opened, edited, or synchronized

**Logic:**
- Detects linked issues using GitHub's closing keywords:
  - `#123` (direct reference)
  - `closes #123`, `close #123`
  - `resolves #123`, `resolve #123`
  - `fixes #123`, `fix #123`
  - `fixed #123`
- For each linked issue (if NOT stale):
  - Move issue to **Progress**
  - Remove from **Backlog** if present

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column ID for `progress`

### 3. Stale Label Handler (`stale-label.yml`)

**Trigger:** When a label is added or removed from an issue or PR

**Logic:**
- **Stale label added** → Move item to **Waiting** (overrides current column)
- **Stale label removed** → Re-evaluate position based on other automations

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column ID for `waiting`
- Label name (default: "Stale")

### 4. Backlog Sync (`backlog-sync.yml`)

**Trigger:**
- Hourly schedule (every hour)
- Manual trigger via workflow dispatch
- When issues are opened, labeled, or unlabeled
- When PRs are opened or closed

**Logic:**
For each issue in your project:
- **Should be in Backlog if:**
  - Is an issue (not a PR)
  - Has NO linked PR
  - Does NOT have the Stale label
  - Opened by you OR assigned to you
  
- **Action:** Move to Backlog if criteria met, move to Todo if criteria no longer met

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column IDs for `backlog` and `todo`

## Automation Flow Diagram

```
GitHub Event (PR/Issue/Label change)
           ↓
┌─────────────────────────────────────┐
│   GitHub Actions Workflows          │
├─────────────────────────────────────┤
│ • pr-state-changes.yml              │
│ • issue-pr-link.yml                 │
│ • stale-label.yml                   │
│ • backlog-sync.yml                  │
└─────────────────────────────────────┘
           ↓
    Update Project via
    ProjectV2 GraphQL API
           ↓
┌─────────────────────────────────────┐
│   Personal Project Board            │
├─────────────────────────────────────┤
│ Kanban: Todo, Progress, Review,     │
│         Waiting, Done               │
│ Backlog: Unlinked issues            │
└─────────────────────────────────────┘
```

## Example Workflows

### Example 1: Create Issue → Appears in Backlog

```
1. You create Issue #42 in a repo you own
   ↓
2. Backlog Sync workflow triggers
   ↓
3. Detects: No linked PR + No Stale label
   ↓
4. Adds to project and moves to Backlog
```

### Example 2: Link PR to Issue → Issue Moves to Progress

```
1. You create PR #5 with description "Closes #42"
   ↓
2. issue-pr-link.yml workflow triggers
   ↓
3. Parses PR body and finds linked issue #42
   ↓
4. Checks if issue has Stale label (it doesn't)
   ↓
5. Moves issue #42 to Progress
   ↓
6. Removes issue from Backlog
```

### Example 3: Add Stale Label → Item Moves to Waiting

```
1. You label Issue #42 with "Stale"
   ↓
2. stale-label.yml workflow triggers
   ↓
3. Detects "Stale" label was added
   ↓
4. Moves item to Waiting (regardless of current column)
```

### Example 4: Merge PR → PR Moves to Done

```
1. You merge PR #5
   ↓
2. pr-state-changes.yml workflow triggers
   ↓
3. Detects PR is now closed/merged
   ↓
4. Moves PR to Done column
```

## Configuration File

The `.github/project-config.json` file controls all automation:

```json
{
  "projectNumber": 1,
  "projectId": "MDEyOlByb2plY3RWMjoxNjM3MDQ=",
  "statusFieldId": "PVTF123456",
  "columns": {
    "backlog": "12345678",
    "todo": "12345679",
    "progress": "1234567a",
    "review": "1234567b",
    "waiting": "1234567c",
    "done": "1234567d"
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

### Configuration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `projectNumber` | Yes | Your GitHub Project number (from URL) |
| `projectId` | Yes | Full project ID from GraphQL (starts with MDEy) |
| `statusFieldId` | Yes | ID of the Status field in your project |
| `columns.backlog` | Yes | Option ID for Backlog column |
| `columns.todo` | Yes | Option ID for Todo column |
| `columns.progress` | Yes | Option ID for Progress column |
| `columns.review` | No | Option ID for Review column |
| `columns.waiting` | Yes | Option ID for Waiting column |
| `columns.done` | Yes | Option ID for Done column |
| `labels.stale` | No | Name of your stale label (default: "Stale") |
| `automations.*` | No | Enable/disable individual automations |

## Project Board Setup

### Recommended Columns

1. **Backlog** - Issues without linked PRs (non-stale)
2. **Todo** - Work items not yet started
3. **Progress** - Open PRs and issues with linked PRs
4. **Review** - Items awaiting review (manual)
5. **Waiting** - Stale items or blocked issues
6. **Done** - Completed work (closed PRs)

### Optional: Backlog Table

Create a separate Table view that shows:
- All items in the Backlog column
- Useful for planning and prioritization
- Automatically stays in sync via backlog-sync.yml

## Limitations

### Current Limitations

1. **ProjectV2 API Maturity** - Some ProjectV2 features are still in beta
2. **Cross-Org Queries** - Need to be a member of organizations to see their issues
3. **Rate Limiting** - GraphQL queries count toward GitHub's rate limit
4. **Manual Project Creation** - GitHub Projects V2 cannot be created via API

### Known Issues

- Issue-PR linking only detects closing keywords in PR description (not comments)
- Stale label takes priority over other states
- Manual column moves are respected but won't be overridden by automations

## Performance

- **PR State Changes** - Instant (~1-2 seconds)
- **Stale Label Handler** - Instant (~1-2 seconds)
- **Issue-PR Link Detection** - ~2-5 seconds
- **Backlog Sync** - ~10-30 seconds (depending on project size)

For projects with 100+ items, backlog sync may take longer but won't impact GitHub's UI.

## Test Scenarios

Use these scenarios to validate expected behavior after setup:

1. **PR lifecycle**
   - Open or reopen a PR → item should be added (if needed) and moved to **Progress**
   - Merge or close the PR → item should move to **Done**

2. **Issue linked from PR body**
   - Add `Closes #<issue-number>` to PR description
   - Linked issue should be added (if needed) and moved to **Progress**

3. **Stale label handling**
   - Add **Stale** label to an issue or PR → item should move to **Waiting**
   - Remove **Stale** from an issue:
     - if it has a linked open PR → **Progress**
     - otherwise → **Todo**

4. **Backlog sync eligibility**
   - Open issue created by you (or assigned to you), with no stale label and no linked open PR
   - Hourly sync should add/move it to **Backlog**
   - Add stale label or link an open PR, then sync/event trigger should move it out of **Backlog** to **Todo**

## Rate Limiting Considerations

- GraphQL calls use pagination (`first: 100`) to keep responses bounded.
- Helper functions retry ProjectV2 GraphQL calls when rate limits are hit.
- Backlog sync narrows queries to open issues and deduplicates results to reduce total API usage.
- For very large portfolios, consider reducing sync frequency or splitting automations by repository scope.

## Troubleshooting

### Workflows Not Running

**Check:**
- GitHub Actions are enabled in repository settings
- Workflows files exist in `.github/workflows/`
- Go to **Actions** tab to see workflow status

### Items Not Moving

**Check:**
- Verify all IDs in `.github/project-config.json` are correct
- Confirm the item is actually in your project
- Check workflow logs for GraphQL errors
- Ensure item matches the workflow's criteria

**Common Errors:**
- `"Project not found"` - Wrong `projectId`
- `"Field not found"` - Wrong `statusFieldId`
- `"Option not found"` - Wrong column ID

### Items Not Appearing in Project

**Check:**
- Project is configured to include items from your repos
- You are the author or assignee of the items
- Items are in repositories the project tracks

## Customization

### Change Stale Label Name

Edit `.github/project-config.json`:
```json
"labels": {
  "stale": "YourLabelName"
}
```

### Adjust Backlog Sync Frequency

Edit `.github/workflows/backlog-sync.yml`:
```yaml
schedule:
  - cron: '0 */4 * * *'  # Change to every 4 hours
```

### Add Custom Automations

Create new workflow files following the same pattern:
- Trigger on relevant events
- Use `actions/github-script@v7` to query ProjectV2 API
- Update project items using GraphQL mutations

## Resources

- [GitHub Projects API Documentation](https://docs.github.com/en/graphql/reference)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [ProjectV2 GraphQL Reference](https://docs.github.com/en/graphql-core/reference/objects#projectv2)
- [Setup Guide](setup.md) - Step-by-step setup instructions
