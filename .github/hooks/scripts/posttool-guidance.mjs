import process from 'node:process';

const input = await readJson();
const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};
const touched = collectFiles(toolInput);

if (!isEditLike(toolName)) {
  writeJson({ continue: true });
  process.exit(0);
}

const requiresValidation = touched.some((file) =>
  /^(src\/|test\/|package\.json$|tsconfig\.json$|eslint\.config\.mjs$|esbuild\.js$)/.test(normalize(file))
);

if (!requiresValidation) {
  writeJson({ continue: true });
  process.exit(0);
}

writeJson({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      'Repository guidance: changes touched source or build-critical files. Before concluding, verify with the narrowest relevant command among npm run check-types, npm run lint, and npm test, and distinguish baseline failures from new regressions.'
  }
});

function isEditLike(name) {
  return /edit|create/i.test(name);
}

function normalize(value) {
  return String(value || '').replace(/^\.\//, '');
}

function collectFiles(toolInput) {
  const values = [];

  if (Array.isArray(toolInput.files)) {
    values.push(...toolInput.files);
  }

  if (toolInput.filePath) {
    values.push(toolInput.filePath);
  }

  if (toolInput.path) {
    values.push(toolInput.path);
  }

  return values.map(normalize).filter(Boolean);
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function readJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}