# Automation Documentation

## Overview

This project uses GitHub Actions workflows to automatically manage your personal GitHub Project Board. The system intelligently moves issues and PRs between columns based on their state, labels, and relationships.

## Workflows

### 1. PR State Changes (`pr-state-changes.yml`)

**Trigger:** When a PR is opened, reopened, closed, or synchronized

**Logic:**
- **PR opened or reopened** → Move to **Progress**
- **PR closed or merged** → Move to **Done**

These are genuine state changes on the PR itself, so the workflow sets the correct column regardless of the current rank (downward moves are allowed).

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
- For each linked issue:
  - Move issue to **Progress** only if Progress is a higher rank than the issue's current column (promote-only).
  - If the issue is already at **Waiting**, **Review**, or **Done**, it is left where it is.
  - Brand-new items (not yet on the board) are added and placed in Progress.

**Column rank ordering:** `backlog (0) < todo (1) < progress (2) < waiting (3) < review (4) < done (5)`

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column ID for `progress`

### 3. Stale Label Handler (`stale-label.yml`)

**Trigger:** When a label is added or removed from an issue or PR

**Logic:**
- **Stale label added** → Move item to **Waiting** (overrides current column — this is a genuine state change on the item)
- **Stale label removed** → Re-evaluate position based on other automations

These are genuine state changes on the item itself, so the workflow sets the correct column regardless of the current rank (downward moves are allowed).

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
- **Only seeds brand-new items into Backlog.** For each eligible issue (open, authored by or assigned to you, no Stale label, no linked open PR) that is **not yet on the project board**, the workflow adds it and places it in **Backlog**.
- **Never moves existing items.** If an item is already on the board (in any column), Backlog Sync does **not** change its status. Manual placement and moves made by other workflows are fully respected.
- **Status cache:** At the end of each run, the workflow uploads a `status-cache.json` artifact recording every project item's current status option ID. On subsequent runs it downloads the most recent artifact (best-effort — the first run tolerates the artifact not existing) to maintain a history of last-known statuses.

**What Backlog Sync no longer does:**
- It does **not** force eligible issues back to Backlog if they were manually moved elsewhere.
- It does **not** promote issues from Backlog to Todo when they become ineligible.

**Configuration Required:**
- `projectId` in `.github/project-config.json`
- `statusFieldId` in `.github/project-config.json`
- Column IDs for `backlog`
- `actions: write` permission (required for artifact upload)

## Column Rank Ordering

All promote-only automation decisions use the following rank:

| Rank | Column   |
|------|----------|
| 0    | Backlog  |
| 1    | Todo     |
| 2    | Progress |
| 3    | Waiting  |
| 4    | Review   |
| 5    | Done     |

A workflow using promote-only logic will only move an item to a column with a **higher rank** than its current column. Items with no status (brand-new) are always allowed to be moved to any column.

**Exception:** Workflows triggered by a genuine state change on the issue/PR itself (`pr-state-changes.yml` and `stale-label.yml`) may move an item to any column, including lower-ranked ones, because the move reflects the real state of the item.

## Automation Flow Diagram

```
GitHub Event (PR/Issue/Label change)
           ↓
┌─────────────────────────────────────┐
│   GitHub Actions Workflows          │
├─────────────────────────────────────┤
│ • pr-state-changes.yml              │
│ • issue-pr-link.yml (promote-only)  │
│ • stale-label.yml                   │
│ • backlog-sync.yml (new items only) │
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
│ Backlog: Unlinked issues (new only) │
└─────────────────────────────────────┘
```

## Example Workflows

### Example 1: Create Issue → Appears in Backlog

```
1. You create Issue #42 in a repo you own
   ↓
2. Backlog Sync workflow triggers
   ↓
3. Detects: Issue #42 is NOT yet on the board
   ↓
4. Adds to project and places in Backlog
```

*Note: If Issue #42 already exists on the board (even in another column), Backlog Sync does nothing — its status is left unchanged.*

### Example 2: Link PR to Issue → Issue Moves to Progress (promote-only)

```
1. You create PR #5 with description "Closes #42"
   ↓
2. issue-pr-link.yml workflow triggers
   ↓
3. Parses PR body and finds linked issue #42
   ↓
4. Checks rank: Issue #42 is in Backlog (rank 0), Progress is rank 2
   ↓
5. Progress > Backlog → promotes issue #42 to Progress
```

*If Issue #42 were already in Review (rank 4) or Done (rank 5), it would NOT be moved — promote-only logic prevents demoting to Progress (rank 2).*

### Example 3: Add Stale Label → Item Moves to Waiting

```
1. You label Issue #42 with "Stale"
   ↓
2. stale-label.yml workflow triggers
   ↓
3. Detects "Stale" label was added (genuine state change)
   ↓
4. Moves item to Waiting (any rank allowed — state change exception)
```

### Example 4: Merge PR → PR Moves to Done

```
1. You merge PR #5
   ↓
2. pr-state-changes.yml workflow triggers
   ↓
3. Detects PR is now closed/merged (genuine state change)
   ↓
4. Moves PR to Done column (any rank allowed — state change exception)
```

### Example 5: Manual Move Is Respected

```
1. Issue #42 is in Backlog
   ↓
2. You manually drag Issue #42 to Review on the project board
   ↓
3. Backlog Sync runs (hourly)
   ↓
4. Issue #42 is already on the board → Backlog Sync leaves it in Review
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

1. **Backlog** - New issues without linked PRs (seeded by Backlog Sync; manual moves respected)
2. **Todo** - Work items not yet started
3. **Progress** - Open PRs and issues with linked PRs
4. **Review** - Items awaiting review
5. **Waiting** - Stale items or blocked issues
6. **Done** - Completed work (closed PRs)

The column rank ordering used by automation is: `Backlog (0) < Todo (1) < Progress (2) < Waiting (3) < Review (4) < Done (5)`.

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
- Stale label takes priority over other states (this is intentional — it is a genuine state change)
- Manual column moves are fully respected by all automations. Backlog Sync only seeds brand-new items into Backlog and never moves existing items. `issue-pr-link.yml` only promotes (never demotes) based on the column rank ordering.

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
   - Linked issue should be added (if needed) and moved to **Progress** (only if Progress is a higher rank than the issue's current column)
   - If the issue is already in **Waiting**, **Review**, or **Done**, it should stay where it is

3. **Stale label handling**
   - Add **Stale** label to an issue or PR → item should move to **Waiting**
   - Remove **Stale** from an issue:
     - if it has a linked open PR → **Progress**
     - otherwise → **Todo**

4. **Backlog sync — new item**
   - Open issue created by you (or assigned to you), with no stale label and no linked open PR, not yet on the board
   - Hourly sync should add it to the board and place it in **Backlog**

5. **Backlog sync — existing item (manual move respected)**
   - Take an issue already on the board and manually move it to any column (e.g., **Review**)
   - Run Backlog Sync (hourly or via workflow dispatch)
   - The issue should remain in **Review** — Backlog Sync must not move it back to Backlog or to Todo

6. **Status cache artifact**
   - After a Backlog Sync run, a `status-cache` artifact should appear in the workflow run's artifacts
   - On the next run, the artifact should be downloaded and the log should show the number of cached entries loaded

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
