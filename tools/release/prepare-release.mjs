import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const CHANNELS = new Set(['beta', 'stable']);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function parseArgs(argv) {
  const args = {
    channel: 'beta',
    commit: false,
    tag: false,
    push: false,
    githubRelease: false,
    verify: false,
    date: new Date().toISOString().slice(0, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--version') {
      args.version = argv[++index];
      continue;
    }

    if (token === '--channel') {
      args.channel = argv[++index];
      continue;
    }

    if (token === '--date') {
      args.date = argv[++index];
      continue;
    }

    if (token === '--commit') {
      args.commit = true;
      continue;
    }

    if (token === '--tag') {
      args.tag = true;
      continue;
    }

    if (token === '--push') {
      args.push = true;
      continue;
    }

    if (token === '--github-release') {
      args.githubRelease = true;
      continue;
    }

    if (token === '--verify') {
      args.verify = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    throw new Error(`Unsupported argument: ${token}`);
  }

  return args;
}

function printUsage() {
  console.log(`\nUsage:\n  node tools/release/prepare-release.mjs --version <x.y.z> [options]\n\nOptions:\n  --channel <beta|stable>   Release channel (default: beta)\n  --date <YYYY-MM-DD>       Release date in changelog (default: today UTC)\n  --verify                  Run npm run test:release after file updates\n  --commit                  Commit package.json and CHANGELOG.md\n  --tag                     Create annotated git tag v<version>\n  --push                    Push master and tags to origin\n  --github-release          Create GitHub release via gh CLI\n  --help                    Show this help\n\nExamples:\n  node tools/release/prepare-release.mjs --version 0.1.2 --channel beta\n  node tools/release/prepare-release.mjs --version 0.1.2 --channel beta --verify --commit --tag --push\n  node tools/release/prepare-release.mjs --version 0.1.2 --channel beta --commit --tag --push --github-release\n`);
}

function ensureGitAvailable() {
  run('git', ['rev-parse', '--is-inside-work-tree']);
}

function ensureGhAvailable() {
  run('gh', ['--version']);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function releaseTemplate(version, date, channel) {
  const header = `## [${version}] - ${date}`;
  const summary = [
    '### Summary',
    `- release ${version} prepared for ${channel} publication.`,
  ];

  if (channel === 'stable') {
    return `${header}\n\n${summary.join('\n')}\n`;
  }

  return `${header}\n\n${summary.join('\n')}\n\n### Beta Disclaimer\n- this is a beta prerelease intended for validation and feedback.\n- behavior and feature surface may change before stable.\n\n### Known Limitations\n- only Tomcat is supported in this release.\n- some advanced workflows and hardening tasks are still in progress.\n`;
}

function updateChangelog(changelogPath, version, date, channel) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const heading = `## [${version}]`;

  if (changelog.includes(heading)) {
    return {
      updated: false,
      releaseNotes: extractReleaseSection(changelog, version),
    };
  }

  const unreleasedHeading = '## [Unreleased]';
  if (!changelog.includes(unreleasedHeading)) {
    throw new Error('CHANGELOG.md must contain an Unreleased section.');
  }

  const template = releaseTemplate(version, date, channel);
  const versionHeadingRegex = /^## \[\d+\.\d+\.\d+\]/m;
  const match = versionHeadingRegex.exec(changelog);

  if (!match || typeof match.index !== 'number') {
    throw new Error('CHANGELOG.md must contain at least one version section to insert before.');
  }

  const nextChangelog = `${changelog.slice(0, match.index).trimEnd()}\n\n${template}\n${changelog.slice(match.index)}`;
  fs.writeFileSync(changelogPath, nextChangelog, 'utf8');

  return {
    updated: true,
    releaseNotes: extractReleaseSection(nextChangelog, version),
  };
}

function extractReleaseSection(changelog, version) {
  const escaped = version.replaceAll('.', '\\.');
  const sectionPattern = new RegExp(`(^## \\[${escaped}\\][\\s\\S]*?)(?=^## \\[|$)`, 'm');
  const match = sectionPattern.exec(changelog);
  return match ? match[1].trim() : '';
}

function ensureCleanWorkingTreeForCommit() {
  const status = run('git', ['status', '--porcelain']);
  if (status.length === 0) {
    throw new Error('No changes detected. Nothing to commit.');
  }
}

function createGitHubRelease(version, channel, notes) {
  ensureGhAvailable();
  const tag = `v${version}`;
  const title = channel === 'beta' ? `${tag} Beta` : tag;

  const tempFile = path.join(os.tmpdir(), `jsm-release-notes-${version}.md`);
  fs.writeFileSync(tempFile, notes, 'utf8');

  const args = ['release', 'create', tag, '--title', title, '--notes-file', tempFile];
  if (channel === 'beta') {
    args.push('--prerelease');
  }

  run('gh', args, { stdio: 'inherit' });
  fs.unlinkSync(tempFile);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.version) {
    throw new Error('--version is required.');
  }

  if (!SEMVER_PATTERN.test(args.version)) {
    throw new Error(`Invalid version "${args.version}". Expected x.y.z.`);
  }

  if (!CHANNELS.has(args.channel)) {
    throw new Error(`Invalid channel "${args.channel}". Expected beta or stable.`);
  }

  ensureGitAvailable();

  const packagePath = path.join(process.cwd(), 'package.json');
  const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');

  const manifest = readJson(packagePath);
  manifest.version = args.version;
  writeJson(packagePath, manifest);

  const changelogResult = updateChangelog(changelogPath, args.version, args.date, args.channel);
  const tag = `v${args.version}`;

  console.log(`Updated package.json version to ${args.version}.`);
  console.log(changelogResult.updated
    ? `Inserted changelog entry for ${args.version}.`
    : `Changelog entry for ${args.version} already existed.`);

  if (args.verify) {
    run('npm', ['run', 'test:release'], { stdio: 'inherit' });
  }

  if (args.commit) {
    ensureCleanWorkingTreeForCommit();
    run('git', ['add', 'package.json', 'CHANGELOG.md']);
    run('git', ['commit', '-m', `chore(release): prepare ${tag}`], { stdio: 'inherit' });
  }

  if (args.tag) {
    run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
    console.log(`Created tag ${tag}.`);
  }

  if (args.push) {
    run('git', ['push', 'origin', 'master', '--follow-tags'], { stdio: 'inherit' });
  }

  if (args.githubRelease) {
    const notes = changelogResult.releaseNotes || releaseTemplate(args.version, args.date, args.channel);
    createGitHubRelease(args.version, args.channel, notes);
  }

  console.log('\nDone.');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
