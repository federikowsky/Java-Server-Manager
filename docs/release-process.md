# VS Code Marketplace Release Process

## Status

This document is the canonical release operations policy for Java Server Manager as of March 18, 2026.

- Scope: VS Code Marketplace publication only.
- Product posture: advanced MVP, Tomcat-only implementation, plugin-ready architecture.
- Planning baseline: [docs/vscode-marketplace-release-foundation.plan.md](./vscode-marketplace-release-foundation.plan.md).
- Workflow implementation: [`.github/workflows/release-marketplace.yml`](../.github/workflows/release-marketplace.yml).

## Canonical Sources

- Release policy and stage gates: this document.
- Product and domain specification: [docs/specs.md](./specs.md).
- Documentation source-of-truth map: [docs/documentation-map.md](./documentation-map.md).
- Frozen release decisions: [docs/release-decision-log.md](./release-decision-log.md).
- Release history: [CHANGELOG.md](../CHANGELOG.md).

## Release Tracks

### Beta

- Purpose: early feedback and integration validation through Marketplace pre-release publication.
- GitHub source event: published GitHub release with `prerelease: true`.
- Minimum gate:
  - `npm run lint`
  - `npm run check-types`
  - `npm run test:smoke`
  - `npm run test:release`
  - repository audits for layer boundaries and `shell: true`
  - production package build and VSIX generation
- Allowed waivers:
  - documented non-critical gaps only
- Not allowed:
  - known security blockers
  - known data-loss or corruption risks
  - activation or install blockers
- Release notes contract:
  - must contain `## Summary`
  - must contain `## Beta Disclaimer`
  - must contain `## Known Limitations`

### Stable

- Purpose: general Marketplace release for broad adoption.
- GitHub source event: published GitHub release with `prerelease: false`.
- Full gate:
  - `npm run lint`
  - `npm run check-types`
  - `npm test`
  - `npm run test:release`
  - repository audits for layer boundaries and `shell: true`
  - production package build and VSIX generation
  - documentation and changelog alignment check
- No waivers allowed for:
  - security blockers
  - data integrity risks
  - activation or install blockers
- Release notes contract:
  - must contain `## Summary`

## Hard Invariants

All invariants are blocking.

1. Version invariant
   - Git tag format is `v<major>.<minor>.<patch>`.
   - Git tag version equals `package.json` version.
   - `CHANGELOG.md` contains a matching `## [<version>]` entry.
2. Source invariant
   - Release commit is the tagged commit.
   - Tagged commit is reachable from `origin/master`.
3. Approval invariant
   - Publish job runs only in a protected environment.
   - `VSCE_PAT` is scoped to the protected environment only.
4. Identity invariant
   - Marketplace publisher is provided by repository variable `JSM_MARKETPLACE_PUBLISHER`.
   - If `package.json` later adds a `publisher`, it must match that variable.
5. Idempotency invariant
   - Publish uses `--skip-duplicate`.
   - Reruns must converge on the same tag, version, and Marketplace target.
6. Traceability invariant
   - Release summary records channel, tag, version, commit SHA, VSIX file name, and SHA-256 checksum.

## Ownership Model

- Release Owner
  - initiates the release
  - owns release completion and release notes accuracy
- Approver
  - approves the protected `marketplace-beta` or `marketplace-stable` environment
  - confirms go/no-go checklist completion
- Incident Commander
  - owns failed or partial release response
  - decides forward-fix path and advisory wording

## Workflow Topology

The release workflow is separate from CI and supports two entry paths:

1. `release` event
   - canonical path
   - uses the GitHub release that was just published
2. `workflow_dispatch`
   - fallback path
   - requires an existing tag
   - fetches the GitHub release by tag and applies the same checks
   - does not allow publishing an arbitrary branch or commit

The workflow stages are fixed:

1. `preflight`
   - resolve release metadata
   - validate tag, version, changelog, release notes, publisher identity, and master ancestry
2. `quality`
   - execute Beta or Stable gate checks
3. `package`
   - build production assets
   - inject publisher identity into the ephemeral CI workspace
   - create a VSIX and SHA-256 checksum
4. `publish`
   - require environment approval
   - publish the exact VSIX generated in `package`
   - publish with `VSCE_PAT`
   - keep reruns safe with `--skip-duplicate`
5. `verify`
   - poll the Marketplace API with bounded retry
   - confirm target version visibility
   - emit the final release summary

## Security And Environment Model

- Concurrency group: one Marketplace release at a time, no cancel-in-progress.
- Repository variable:
  - `JSM_MARKETPLACE_PUBLISHER`
- Protected environments:
  - `marketplace-beta`
  - `marketplace-stable`
- Environment secret:
  - `VSCE_PAT`
- Publish secret access is limited to the `publish` job.

## Go Or No-Go Checklists

### Beta

Go only when all are true:

- preflight invariants pass
- Beta minimum gate passes
- release notes include the required Beta sections
- environment approval is granted

No-Go when any are true:

- known critical security issue
- known data-loss or corruption issue
- activation or installation blocker
- tag, manifest, or changelog mismatch

### Stable

Go only when all are true:

- preflight invariants pass
- Stable full gate passes
- documentation is aligned with repo reality
- environment approval is granted

No-Go when any are true:

- release-blocking issue remains open
- mandatory audit fails
- waiver is requested for a blocked category

## Incident Model

- Severity 1: security, data-loss, or activation break in a published release
- Severity 2: critical functionality degraded but the extension still loads
- Severity 3: non-critical regression or documentation inconsistency

Response procedure:

1. classify severity
2. freeze new release approvals
3. verify Marketplace state and affected version
4. choose recovery path
   - forward-fix patch release
   - temporary publish halt
5. publish advisory and update known issues
6. record the decision in [docs/release-decision-log.md](./release-decision-log.md)

Rollback policy:

- no overwrite rollback
- forward-fix patch release is mandatory

## Changelog Contract

- `CHANGELOG.md` remains `Unreleased`-only until the first official Beta or Stable publication.
- Every actual release must add a matching version section before approval.
- Release publication is blocked if the version entry is missing.
