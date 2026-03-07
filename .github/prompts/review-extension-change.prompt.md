---
name: review-extension-change
description: Review a change in the extension for production risk, regressions, and missing verification.
agent: Reviewer
argument-hint: Optional focus such as runtime, manifest, docs, or deployment flow.
---
Review the current change set in this repository.

Focus on:

- behavior regressions
- manifest and command contribution mismatches
- deployment and runtime safety
- documentation drift
- missing validation or tests

Present findings first. If no findings are present, state residual risk and verification gaps.