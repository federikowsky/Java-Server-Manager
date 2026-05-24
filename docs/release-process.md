# Release Process

JSM releases are driven by GitHub Actions, not by local publishing from a developer workstation.

## Local Preflight

Run from repository root:

```bash
npm ci
npm run lint
npm run check-types
npm test
npm run build
npm run package
npm run test:release
```

For local VSIX verification:

```bash
npx --yes @vscode/vsce package --out java-server-manager-local.vsix
```

## Beta Release

1. Update `package.json` version and `CHANGELOG.md`.
2. Commit and push to `master`.
3. Create and push a tag:

```bash
git tag vX.Y.Z
git push origin master vX.Y.Z
```

4. The `release-marketplace.yml` workflow runs preflight, quality checks, package, Marketplace publish, OpenVSX publish, GitHub release upload, and registry verification.

## Required Secrets

- `VSCE_PAT` for Visual Studio Marketplace publication.
- `OVSX_PAT` for OpenVSX publication.

## Verification

Use the workflow summary and registry URLs:

```bash
JSM_MARKETPLACE_PUBLISHER=federikowsky JSM_EXTENSION_NAME=java-server-manager RELEASE_VERSION=X.Y.Z npm run release:verify
JSM_MARKETPLACE_PUBLISHER=federikowsky JSM_EXTENSION_NAME=java-server-manager RELEASE_VERSION=X.Y.Z npm run release:verify:openvsx
```

Publishing is complete only when GitHub release upload and both registry verification steps pass.
