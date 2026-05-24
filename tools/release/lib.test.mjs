import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKETPLACE_QUERY_FLAGS,
  OPENVSX_REGISTRY_URL,
  buildOpenVsxVersionsUrl,
  buildMarketplaceQuery,
  buildRetryDelaySchedule,
  changelogHasVersionEntry,
  extractMarketplaceVersions,
  extractOpenVsxVersions,
  hasOpenVsxVersion,
  hasMarketplaceVersion,
  missingReleaseNoteSections,
  parseVersionFromTag,
} from './lib.mjs';

test('parseVersionFromTag accepts plain semver tags', () => {
  assert.equal(parseVersionFromTag('v1.2.3'), '1.2.3');
});

test('parseVersionFromTag rejects invalid tags', () => {
  assert.throws(() => parseVersionFromTag('1.2.3'));
  assert.throws(() => parseVersionFromTag('v1.2'));
});

test('missingReleaseNoteSections enforces beta note headings', () => {
  const missing = missingReleaseNoteSections('beta', '## Summary\n\ntext\n');
  assert.deepEqual(missing, ['## Beta Disclaimer', '## Known Limitations']);
});

test('missingReleaseNoteSections accepts complete stable notes', () => {
  const missing = missingReleaseNoteSections('stable', '## Summary\n\nready\n');
  assert.deepEqual(missing, []);
});

test('changelogHasVersionEntry matches a version heading', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\n## [0.0.1] - 2026-03-18\n';
  assert.equal(changelogHasVersionEntry(changelog, '0.0.1'), true);
  assert.equal(changelogHasVersionEntry(changelog, '0.0.2'), false);
});

test('buildMarketplaceQuery targets the extension id and required flags', () => {
  const payload = buildMarketplaceQuery('publisher.extension');
  assert.equal(payload.filters[0].criteria[0].filterType, 7);
  assert.equal(payload.filters[0].criteria[0].value, 'publisher.extension');
  assert.equal(payload.flags, MARKETPLACE_QUERY_FLAGS);
});

test('extractMarketplaceVersions returns published versions', () => {
  const payload = {
    results: [
      {
        extensions: [
          {
            versions: [{ version: '0.0.1' }, { version: '0.0.2' }],
          },
        ],
      },
    ],
  };

  assert.deepEqual(extractMarketplaceVersions(payload), ['0.0.1', '0.0.2']);
  assert.equal(hasMarketplaceVersion(payload, '0.0.2'), true);
  assert.equal(hasMarketplaceVersion(payload, '0.0.3'), false);
});

test('buildRetryDelaySchedule uses bounded exponential backoff', () => {
  assert.deepEqual(buildRetryDelaySchedule(4, 1000), [1000, 2000, 4000]);
});

test('buildRetryDelaySchedule caps exponential backoff delays', () => {
  assert.deepEqual(buildRetryDelaySchedule(6, 1000, 2500), [1000, 2000, 2500, 2500, 2500]);
});

test('buildOpenVsxVersionsUrl composes the versions endpoint', () => {
  assert.equal(
    buildOpenVsxVersionsUrl('publisher', 'extension'),
    `${OPENVSX_REGISTRY_URL}/api/publisher/extension/versions`,
  );
});

test('extractOpenVsxVersions parses versions map and detects target version', () => {
  const payload = {
    versions: {
      '0.1.0': 'https://open-vsx.org/api/publisher/extension/0.1.0',
      '0.1.1': { version: '0.1.1' },
    },
    allVersions: {
      '0.1.2': 'https://open-vsx.org/api/publisher/extension/0.1.2',
    },
    '0.1.3': { version: '0.1.3' },
    irrelevant: true,
  };

  assert.deepEqual(extractOpenVsxVersions(payload).sort(), ['0.1.0', '0.1.1', '0.1.2', '0.1.3']);
  assert.equal(hasOpenVsxVersion(payload, '0.1.3'), true);
  assert.equal(hasOpenVsxVersion(payload, '0.1.4'), false);
});
