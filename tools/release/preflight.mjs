import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  appendGitHubOutput,
  assertFileExists,
  changelogHasVersionEntry,
  missingReleaseNoteSections,
  parseVersionFromTag,
  readJsonFile,
} from './lib.mjs';

function runGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolvePublisher(manifest) {
  const publisher = process.env.JSM_MARKETPLACE_PUBLISHER?.trim();
  if (!publisher) {
    throw new Error('Repository variable JSM_MARKETPLACE_PUBLISHER is required.');
  }

  if (manifest.publisher && manifest.publisher !== publisher) {
    throw new Error(
      `Manifest publisher "${manifest.publisher}" does not match JSM_MARKETPLACE_PUBLISHER "${publisher}".`,
    );
  }

  return publisher;
}

function loadReleaseOverride() {
  const tag = process.env.RELEASE_TAG?.trim();
  const channel = process.env.RELEASE_CHANNEL?.trim();
  if (!tag || !channel) {
    return null;
  }

  if (channel !== 'beta' && channel !== 'stable') {
    throw new Error('RELEASE_CHANNEL must be "beta" or "stable" when RELEASE_TAG is set.');
  }

  const bodyFile = process.env.RELEASE_BODY_FILE?.trim();
  const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : process.env.RELEASE_BODY ?? '';

  return {
    tag,
    channel,
    releaseName: process.env.RELEASE_NAME ?? tag,
    releaseUrl: process.env.RELEASE_URL ?? '',
    releaseBody: body,
    publishedAt: process.env.RELEASE_PUBLISHED_AT ?? '',
  };
}

async function fetchReleaseByTag(tag) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required for workflow_dispatch preflight.');
  }

  if (!token) {
    throw new Error('GITHUB_TOKEN is required for workflow_dispatch preflight.');
  }

  const response = await fetch(`${apiUrl}/repos/${repository}/releases/tags/${tag}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'java-server-manager-release-preflight',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release metadata for tag ${tag}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function resolveReleaseContext() {
  const overrideContext = loadReleaseOverride();
  if (overrideContext) {
    return overrideContext;
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName === 'release') {
    const payload = readJsonFile(process.env.GITHUB_EVENT_PATH);
    const release = payload.release;

    if (!release || release.draft) {
      throw new Error('Release event must reference a published, non-draft GitHub release.');
    }

    return {
      tag: release.tag_name,
      channel: release.prerelease ? 'beta' : 'stable',
      releaseName: release.name ?? release.tag_name,
      releaseUrl: release.html_url ?? '',
      releaseBody: release.body ?? '',
      publishedAt: release.published_at ?? '',
    };
  }

  if (eventName === 'workflow_dispatch') {
    const tag = process.env.RELEASE_TAG?.trim();
    if (!tag) {
      throw new Error('workflow_dispatch requires the tag input.');
    }

    const release = await fetchReleaseByTag(tag);
    if (release.draft) {
      throw new Error(`Release ${tag} is still a draft and cannot be published.`);
    }

    return {
      tag: release.tag_name,
      channel: release.prerelease ? 'beta' : 'stable',
      releaseName: release.name ?? release.tag_name,
      releaseUrl: release.html_url ?? '',
      releaseBody: release.body ?? '',
      publishedAt: release.published_at ?? '',
    };
  }

  throw new Error(`Unsupported event "${eventName ?? 'unknown'}".`);
}

async function main() {
  const manifestPath = path.join(process.cwd(), 'package.json');
  const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');

  for (const requiredPath of [
    'README.md',
    'CHANGELOG.md',
    'docs/documentation-map.md',
  ]) {
    assertFileExists(path.join(process.cwd(), requiredPath));
  }

  const manifest = readJsonFile(manifestPath);
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const publisher = resolvePublisher(manifest);
  const release = await resolveReleaseContext();

  const version = parseVersionFromTag(release.tag);
  if (manifest.version !== version) {
    throw new Error(`Manifest version ${manifest.version} does not match release tag ${release.tag}.`);
  }

  const missingSections = missingReleaseNoteSections(release.channel, release.releaseBody);
  if (missingSections.length > 0) {
    throw new Error(
      `Release notes for ${release.channel} are missing required sections: ${missingSections.join(', ')}`,
    );
  }

  if (!changelogHasVersionEntry(changelog, version)) {
    throw new Error(`CHANGELOG.md does not contain a version entry for ${version}.`);
  }

  let commitSha;
  try {
    commitSha = runGit(['rev-list', '-n', '1', release.tag]);
  } catch (error) {
    throw new Error(`Failed to resolve commit for tag ${release.tag}.`);
  }

  if (!commitSha) {
    throw new Error(`Tag ${release.tag} does not resolve to a commit.`);
  }

  try {
    runGit(['rev-parse', '--verify', 'origin/master']);
  } catch (error) {
    throw new Error('origin/master is not available locally. Fetch the master branch before running preflight.');
  }

  try {
    runGit(['merge-base', '--is-ancestor', commitSha, 'origin/master']);
  } catch (error) {
    throw new Error(`Tagged commit ${commitSha} is not reachable from origin/master.`);
  }

  const result = {
    channel: release.channel,
    environmentName: release.channel === 'beta' ? 'marketplace-beta' : 'marketplace-stable',
    tag: release.tag,
    version,
    commitSha,
    publisher,
    extensionName: manifest.name,
    extensionId: `${publisher}.${manifest.name}`,
    releaseName: release.releaseName,
    releaseUrl: release.releaseUrl,
    publishedAt: release.publishedAt,
  };

  for (const [key, value] of Object.entries(result)) {
    appendGitHubOutput(key, value);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
