const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = [
  'projectId',
  'statusFieldId',
  'columns.backlog',
  'columns.todo',
  'columns.progress',
  'columns.waiting',
  'columns.done'
];

function getNestedValue(object, keyPath) {
  return keyPath.split('.').reduce((value, key) => value?.[key], object);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphqlWithRetries(github, query, variables, core, retries = 2) {
  try {
    return await github.graphql(query, variables);
  } catch (error) {
    const isRateLimit =
      String(error?.message || '').toLowerCase().includes('rate limit') ||
      (Array.isArray(error?.errors) &&
        error.errors.some((item) => item?.type === 'RATE_LIMITED'));

    if (isRateLimit && retries > 0) {
      const waitMs = 30000;
      if (core) {
        core.warning(`GraphQL rate limit hit. Retrying in ${waitMs / 1000}s...`);
      }
      await sleep(waitMs);
      return graphqlWithRetries(github, query, variables, core, retries - 1);
    }

    throw error;
  }
}

function loadConfig(basePath = process.cwd()) {
  const configPath = path.join(basePath, '.github', 'project-config.json');
  const configRaw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configRaw);

  const missingFields = REQUIRED_FIELDS.filter((fieldPath) => !getNestedValue(config, fieldPath));
  if (missingFields.length > 0) {
    throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
  }

  if (!config.labels) {
    config.labels = {};
  }
  if (!config.labels.stale) {
    config.labels.stale = 'Stale';
  }
  if (!config.automations) {
    config.automations = {};
  }

  return config;
}

async function queryProject(github, config, core) {
  const items = [];
  let hasNextPage = true;
  let after = null;

  const query = `
    query($projectId: ID!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100, after: $after) {
            nodes {
              id
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    optionId
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              }
              content {
                __typename
                ... on Issue {
                  id
                  number
                  state
                  title
                  repository {
                    name
                    owner {
                      login
                    }
                  }
                }
                ... on PullRequest {
                  id
                  number
                  state
                  title
                  repository {
                    name
                    owner {
                      login
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await graphqlWithRetries(
      github,
      query,
      {
        projectId: config.projectId,
        after
      },
      core
    );

    const page = response?.node?.items;
    if (!page) {
      throw new Error('Malformed GraphQL response while querying project items');
    }

    for (const node of page.nodes || []) {
      const statusFieldValue = (node.fieldValues?.nodes || []).find(
        (fieldNode) => fieldNode?.field?.id === config.statusFieldId
      );

      items.push({
        itemId: node.id,
        contentId: node.content?.id,
        contentType: node.content?.__typename,
        contentNumber: node.content?.number,
        repositoryName: node.content?.repository?.name,
        repositoryOwner: node.content?.repository?.owner?.login,
        contentState: node.content?.state,
        statusOptionId: statusFieldValue?.optionId || null,
        statusName: statusFieldValue?.name || null
      });
    }

    hasNextPage = Boolean(page.pageInfo?.hasNextPage);
    after = page.pageInfo?.endCursor || null;
  }

  return items;
}

async function addItemToProject(github, config, contentId, core) {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item {
          id
        }
      }
    }
  `;

  const response = await graphqlWithRetries(
    github,
    mutation,
    {
      projectId: config.projectId,
      contentId
    },
    core
  );

  return response?.addProjectV2ItemById?.item?.id;
}

async function moveItemInProject(github, config, itemId, columnId, core) {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $statusFieldId: ID!, $columnId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $statusFieldId
          value: { singleSelectOptionId: $columnId }
        }
      ) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await graphqlWithRetries(
    github,
    mutation,
    {
      projectId: config.projectId,
      itemId,
      statusFieldId: config.statusFieldId,
      columnId
    },
    core
  );
}

function findLinkedIssues(prBody) {
  const body = prBody || '';
  const linked = new Set();

  const keywordRegex = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;
  for (const match of body.matchAll(keywordRegex)) {
    if (match[1]) {
      linked.add(Number(match[1]));
    }
  }

  const directRegex = /(?:^|\s)#(\d+)\b/gm;
  for (const match of body.matchAll(directRegex)) {
    if (match[1]) {
      linked.add(Number(match[1]));
    }
  }

  return Array.from(linked);
}

async function queryRepositoriesForUser(github, core) {
  let hasNextPage = true;
  let after = null;
  let viewerLogin = null;
  const repositories = [];

  const query = `
    query($after: String) {
      viewer {
        login
        repositories(
          first: 100
          after: $after
          affiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR]
          ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR]
          orderBy: {field: UPDATED_AT, direction: DESC}
        ) {
          nodes {
            name
            isArchived
            isDisabled
            owner {
              login
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await graphqlWithRetries(github, query, { after }, core);
    const viewer = response?.viewer;

    if (!viewer?.repositories) {
      throw new Error('Malformed GraphQL response while querying repositories');
    }

    viewerLogin = viewer.login;

    for (const repo of viewer.repositories.nodes || []) {
      if (!repo.isArchived && !repo.isDisabled) {
        repositories.push({
          owner: repo.owner.login,
          name: repo.name
        });
      }
    }

    hasNextPage = Boolean(viewer.repositories.pageInfo?.hasNextPage);
    after = viewer.repositories.pageInfo?.endCursor || null;
  }

  return {
    viewerLogin,
    repositories
  };
}

async function queryOpenLinkedIssueIds(github, owner, repo, core) {
  const linkedIssueIds = new Set();
  let hasNextPage = true;
  let after = null;

  const query = `
    query($owner: String!, $repo: String!, $after: String) {
      repository(owner: $owner, name: $repo) {
        pullRequests(first: 100, after: $after, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            closingIssuesReferences(first: 20) {
              nodes {
                id
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await graphqlWithRetries(
      github,
      query,
      {
        owner,
        repo,
        after
      },
      core
    );

    const pullRequestConnection = response?.repository?.pullRequests;
    if (!pullRequestConnection) {
      throw new Error(`Malformed GraphQL response while querying pull requests for ${owner}/${repo}`);
    }

    for (const pullRequest of pullRequestConnection.nodes || []) {
      for (const issue of pullRequest.closingIssuesReferences?.nodes || []) {
        if (issue?.id) {
          linkedIssueIds.add(issue.id);
        }
      }
    }

    hasNextPage = Boolean(pullRequestConnection.pageInfo?.hasNextPage);
    after = pullRequestConnection.pageInfo?.endCursor || null;
  }

  return linkedIssueIds;
}

// Column rank ordering: backlog(0) < todo(1) < progress(2) < waiting(3) < review(4) < done(5)
const COLUMN_RANK_KEYS = ['backlog', 'todo', 'progress', 'waiting', 'review', 'done'];

function getColumnRank(config, columnId) {
  if (!columnId) return -1;
  for (let rank = 0; rank < COLUMN_RANK_KEYS.length; rank++) {
    const key = COLUMN_RANK_KEYS[rank];
    if (config.columns[key] && config.columns[key] === columnId) {
      return rank;
    }
  }
  return -1;
}

function shouldMovePromoteOnly(config, currentColumnId, targetColumnId) {
  if (!currentColumnId) return true;
  const currentRank = getColumnRank(config, currentColumnId);
  const targetRank = getColumnRank(config, targetColumnId);
  return targetRank > currentRank;
}

function loadStatusCache(cacheContent) {
  const cache = new Map();
  if (!cacheContent) return cache;
  try {
    const data = JSON.parse(cacheContent);
    for (const [contentId, statusOptionId] of Object.entries(data)) {
      cache.set(contentId, statusOptionId);
    }
  } catch (e) {
    // Return empty cache on parse error
  }
  return cache;
}

function serializeStatusCache(statusMap) {
  const obj = {};
  for (const [contentId, statusOptionId] of statusMap.entries()) {
    obj[contentId] = statusOptionId;
  }
  return JSON.stringify(obj, null, 2);
}

module.exports = {
  loadConfig,
  queryProject,
  addItemToProject,
  moveItemInProject,
  findLinkedIssues,
  queryRepositoriesForUser,
  queryOpenLinkedIssueIds,
  getColumnRank,
  shouldMovePromoteOnly,
  loadStatusCache,
  serializeStatusCache
};
