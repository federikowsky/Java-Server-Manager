import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { execSync } from 'node:child_process';

const cwd = process.cwd();
const pkgPath = `${cwd}/package.json`;
const auditPath = `${cwd}/PROJECT_TECHNICAL_AUDIT.md`;

let packageSummary = 'unknown project';
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  packageSummary = `${pkg.name || 'unknown'} v${pkg.version || '0.0.0'}`;
}

let branch = 'unknown';
try {
  branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim() || 'unknown';
} catch {}

const context = [
  `Project: ${packageSummary}`,
  `Branch: ${branch}`,
  'Repository type: VS Code extension, TypeScript, Tomcat-first.',
  existsSync(auditPath)
    ? 'Baseline audit file present: PROJECT_TECHNICAL_AUDIT.md.'
    : 'No baseline audit file found.'
].join(' ');

process.stdout.write(`${JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context
  }
})}\n`);