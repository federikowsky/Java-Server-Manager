# AI Customizations For This Repository

This workspace uses the VS Code 1.110 customization model documented in the official Copilot and VS Code docs.

## Included primitives

- Always-on instructions: [.github/copilot-instructions.md](./copilot-instructions.md)
- Cross-agent instructions: [AGENTS.md](../AGENTS.md)
- Path-specific instructions: [.github/instructions](./instructions)
- Custom agents: [.github/agents](./agents)
- Prompt files: [.github/prompts](./prompts)
- Agent skills: [.github/skills](./skills)
- Hooks: [.github/hooks](./hooks)

## Recommended usage in VS Code 1.110

- Run `/instructions` to inspect instruction files.
- Run `/agents` to select or edit custom agents.
- Run `/prompts` or type `/release-readiness`, `/restore-test-pipeline`, `/reconcile-specs`, or `/review-extension-change`.
- Run `/skills` to discover the bundled skills.
- Run `/hooks` to inspect or enable the hook configurations.

## What this setup is optimized for

- production hardening of the extension
- spec and documentation reconciliation
- safe release preparation
- restoration of the test pipeline
- Tomcat runtime and deployment correctness
- security and red-team style review
- performance and scalability review

## Notes

- Hooks are preview functionality in VS Code 1.110. Review them before enabling in shared environments.
- These files are intentionally workspace-scoped so the whole team can share the same AI behavior.