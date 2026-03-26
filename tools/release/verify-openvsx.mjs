import {
  OPENVSX_REGISTRY_URL,
  appendGitHubOutput,
  buildOpenVsxVersionsUrl,
  buildRetryDelaySchedule,
  extractOpenVsxVersions,
  hasOpenVsxVersion,
} from './lib.mjs';

function sleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function queryOpenVsxVersions(publisher, extensionName, registryUrl) {
  const endpoint = buildOpenVsxVersionsUrl(publisher, extensionName, registryUrl);
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'java-server-manager-openvsx-verifier',
    },
  });

  if (response.status === 404) {
    return {};
  }

  if (!response.ok) {
    throw new Error(`OpenVSX query failed with ${response.status} ${response.statusText}.`);
  }

  return response.json();
}

async function main() {
  const publisher = process.env.JSM_MARKETPLACE_PUBLISHER?.trim();
  const extensionName = process.env.JSM_EXTENSION_NAME?.trim();
  const version = process.env.RELEASE_VERSION?.trim();
  const attempts = Number.parseInt(process.env.OPENVSX_VERIFY_ATTEMPTS ?? '6', 10);
  const baseDelayMs = Number.parseInt(process.env.OPENVSX_VERIFY_BASE_DELAY_MS ?? '10000', 10);
  const registryUrl = process.env.OPENVSX_REGISTRY_URL?.trim() || OPENVSX_REGISTRY_URL;

  if (!publisher || !extensionName || !version) {
    throw new Error('JSM_MARKETPLACE_PUBLISHER, JSM_EXTENSION_NAME, and RELEASE_VERSION are required.');
  }

  const extensionId = `${publisher}.${extensionName}`;
  const delaySchedule = buildRetryDelaySchedule(attempts, baseDelayMs);
  let lastSeenVersions = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await queryOpenVsxVersions(publisher, extensionName, registryUrl);
      lastSeenVersions = extractOpenVsxVersions(payload);

      if (hasOpenVsxVersion(payload, version)) {
        appendGitHubOutput('openvsxVerified', 'true');
        appendGitHubOutput('openvsxVerifyAttemptsUsed', String(attempt));
        appendGitHubOutput('openvsxVerifiedExtensionId', extensionId);
        console.log(`Verified OpenVSX ${extensionId}@${version} on attempt ${attempt}.`);
        return;
      }
    } catch (error) {
      console.warn(`OpenVSX verification attempt ${attempt} failed: ${error.message}`);
    }

    const nextDelay = delaySchedule[attempt - 1];
    if (nextDelay) {
      console.log(`OpenVSX version ${version} not visible yet. Retrying in ${nextDelay}ms.`);
      await sleep(nextDelay);
    }
  }

  throw new Error(
    `OpenVSX verification failed for ${extensionId}@${version}. Versions observed: ${
      lastSeenVersions.length > 0 ? lastSeenVersions.join(', ') : 'none'
    }`,
  );
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
