# Release Checklist

Use this checklist when preparing a production-oriented milestone.

1. Repository status and docs reflect implemented behavior.
2. Command handlers and manifest contributions are aligned.
3. `npm run check-types` passes.
4. `npm run lint` passes.
5. `npm test` is green, or the exact blocker and fallback are documented.
6. User-visible changes are documented in README or changelog when needed.
7. Known production blockers are explicitly called out before release.