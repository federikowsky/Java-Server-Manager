import {
  MARKETPLACE_QUERY_URL,
  appendGitHubOutput,
  buildMarketplaceQuery,
  buildRetryDelaySchedule,
  extractMarketplaceVersions,
  hasMarketplaceVersion,
} from './lib.mjs';

function sleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function queryMarketplace(extensionId) {
  const response = await fetch(MARKETPLACE_QUERY_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json;api-version=3.0-preview.1',
      'Content-Type': 'application/json',
      'User-Agent': 'java-server-manager-release-verifier',
      'X-Market-Client-Id': 'java-server-manager-release-workflow',
    },
    body: JSON.stringify(buildMarketplaceQuery(extensionId)),
  });

  if (!response.ok) {
    throw new Error(`Marketplace query failed with ${response.status} ${response.statusText}.`);
  }

  return response.json();
}

async function main() {
  const publisher = process.env.JSM_MARKETPLACE_PUBLISHER?.trim();
  const extensionName = process.env.JSM_EXTENSION_NAME?.trim();
  const version = process.env.RELEASE_VERSION?.trim();
  const attempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? '6', 10);
  const baseDelayMs = Number.parseInt(process.env.VERIFY_BASE_DELAY_MS ?? '10000', 10);
  const maxDelayMs = Number.parseInt(process.env.VERIFY_MAX_DELAY_MS ?? String(Number.MAX_SAFE_INTEGER), 10);

  if (!publisher || !extensionName || !version) {
    throw new Error('JSM_MARKETPLACE_PUBLISHER, JSM_EXTENSION_NAME, and RELEASE_VERSION are required.');
  }

  const extensionId = `${publisher}.${extensionName}`;
  const delaySchedule = buildRetryDelaySchedule(attempts, baseDelayMs, maxDelayMs);
  let lastSeenVersions = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await queryMarketplace(extensionId);
      lastSeenVersions = extractMarketplaceVersions(payload);

      if (hasMarketplaceVersion(payload, version)) {
        appendGitHubOutput('verified', 'true');
        appendGitHubOutput('verifyAttemptsUsed', String(attempt));
        appendGitHubOutput('verifiedExtensionId', extensionId);
        console.log(`Verified ${extensionId}@${version} on attempt ${attempt}.`);
        return;
      }
    } catch (error) {
      console.warn(`Verification attempt ${attempt} failed: ${error.message}`);
    }

    const nextDelay = delaySchedule[attempt - 1];
    if (nextDelay) {
      console.log(`Version ${version} not visible yet. Retrying in ${nextDelay}ms.`);
      await sleep(nextDelay);
    }
  }

  throw new Error(
    `Marketplace verification failed for ${extensionId}@${version}. Versions observed: ${
      lastSeenVersions.length > 0 ? lastSeenVersions.join(', ') : 'none'
    }`,
  );
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
