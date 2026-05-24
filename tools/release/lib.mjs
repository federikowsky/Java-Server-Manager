import fs from 'node:fs';

export const TAG_PATTERN = /^v(?<version>\d+\.\d+\.\d+)$/;
export const MARKETPLACE_QUERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
export const MARKETPLACE_QUERY_FLAGS = 1 + 32 + 65536;
export const OPENVSX_REGISTRY_URL = 'https://open-vsx.org';

const REQUIRED_RELEASE_NOTE_SECTIONS = {
  beta: ['## Summary', '## Beta Disclaimer', '## Known Limitations'],
  stable: ['## Summary'],
};

export function parseVersionFromTag(tag) {
  const match = TAG_PATTERN.exec(tag ?? '');
  if (!match?.groups?.version) {
    throw new Error(`Release tag must match v<major>.<minor>.<patch>; received "${tag ?? ''}".`);
  }

  return match.groups.version;
}

export function getRequiredReleaseNoteSections(channel) {
  if (!(channel in REQUIRED_RELEASE_NOTE_SECTIONS)) {
    throw new Error(`Unsupported release channel "${channel}".`);
  }

  return REQUIRED_RELEASE_NOTE_SECTIONS[channel];
}

export function missingReleaseNoteSections(channel, releaseNotes) {
  const body = releaseNotes ?? '';
  return getRequiredReleaseNoteSections(channel).filter(section => !body.includes(section));
}

export function changelogHasVersionEntry(changelogText, version) {
  const escapedVersion = version.replaceAll('.', '\\.');
  const headingPattern = new RegExp(`^## \\[${escapedVersion}\\](?:\\s+-\\s+.+)?$`, 'm');
  return headingPattern.test(changelogText);
}

export function buildMarketplaceQuery(extensionId) {
  return {
    filters: [
      {
        criteria: [
          {
            filterType: 7,
            value: extensionId,
          },
        ],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    assetTypes: [],
    flags: MARKETPLACE_QUERY_FLAGS,
  };
}

export function extractMarketplaceVersions(payload) {
  const versions = payload?.results?.[0]?.extensions?.[0]?.versions;
  if (!Array.isArray(versions)) {
    return [];
  }

  return versions
    .map(entry => entry?.version)
    .filter(version => typeof version === 'string' && version.length > 0);
}

export function hasMarketplaceVersion(payload, version) {
  return extractMarketplaceVersions(payload).includes(version);
}

export function buildOpenVsxVersionsUrl(publisher, extensionName, baseUrl = OPENVSX_REGISTRY_URL) {
  return `${baseUrl.replace(/\/$/, '')}/api/${encodeURIComponent(publisher)}/${encodeURIComponent(extensionName)}/versions`;
}

export function extractOpenVsxVersions(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const versionCandidates = new Set();
  const addVersionMapCandidates = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(key)) {
        versionCandidates.add(key);
      }

      if (typeof entry?.version === 'string' && entry.version.length > 0) {
        versionCandidates.add(entry.version);
      }
    }
  };

  if (Array.isArray(payload.versions)) {
    for (const entry of payload.versions) {
      if (typeof entry?.version === 'string' && entry.version.length > 0) {
        versionCandidates.add(entry.version);
      }
    }
  } else {
    addVersionMapCandidates(payload.versions);
  }

  if (Array.isArray(payload.allVersions)) {
    for (const entry of payload.allVersions) {
      if (typeof entry?.version === 'string' && entry.version.length > 0) {
        versionCandidates.add(entry.version);
      }
    }
  } else {
    addVersionMapCandidates(payload.allVersions);
  }

  for (const key of Object.keys(payload)) {
    if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(key)) {
      versionCandidates.add(key);
    }
  }

  return [...versionCandidates];
}

export function hasOpenVsxVersion(payload, version) {
  return extractOpenVsxVersions(payload).includes(version);
}

export function buildRetryDelaySchedule(attempts, baseDelayMs, maxDelayMs = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`Retry attempts must be a positive integer; received "${attempts}".`);
  }

  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) {
    throw new Error(`Retry base delay must be a non-negative integer; received "${baseDelayMs}".`);
  }

  if (!Number.isInteger(maxDelayMs) || maxDelayMs < 0) {
    throw new Error(`Retry max delay must be a non-negative integer; received "${maxDelayMs}".`);
  }

  const schedule = [];
  let nextDelay = baseDelayMs;

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    schedule.push(Math.min(nextDelay, maxDelayMs));
    nextDelay = Math.min(nextDelay * 2, maxDelayMs);
  }

  return schedule;
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function appendGitHubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${name}<<__JSM_EOF__\n${String(value)}\n__JSM_EOF__\n`);
}

export function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file is missing: ${filePath}`);
  }
}
