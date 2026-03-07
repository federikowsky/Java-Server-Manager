import process from 'node:process';

const input = await readJson();
const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};
const terminalCommand = String(toolInput.command || '');

const denyPattern = /(rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+checkout\s+--\b|drop\s+table\b|delete\s+from\b|shutdown\b|reboot\b|mkfs\b)/i;
const askPattern = /(git\s+push\b|npm\s+publish\b|vsce\s+publish\b|ovsx\s+publish\b)/i;

if (isTerminalTool(toolName) && denyPattern.test(terminalCommand)) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Blocked by repository hook: destructive terminal command.'
    }
  });
  process.exit(0);
}

if (isTerminalTool(toolName) && askPattern.test(terminalCommand)) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Publishing or pushing requires explicit approval.'
    }
  });
  process.exit(0);
}

if (/delete/i.test(toolName)) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Deletion tools require explicit approval in this repository.'
    }
  });
  process.exit(0);
}

writeJson({ continue: true });

function isTerminalTool(name) {
  return /run.*terminal|run.*command|terminal/i.test(name);
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