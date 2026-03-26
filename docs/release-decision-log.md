# Release Decision Log

## Format

Each entry uses:

- ID
- Date
- Status
- Decision
- Rationale
- Alternatives considered

## Approved Decisions

### REL-001

- Date: March 18, 2026
- Status: Approved
- Decision: `master` is the only release source of truth and no long-lived release branch is introduced.
- Rationale: keeps release ancestry deterministic and matches the approved foundation plan.
- Alternatives considered: dedicated release branches for Beta and Stable. Rejected because they add branching overhead without solving the current release-foundation gaps.

### REL-002

- Date: March 18, 2026
- Status: Approved
- Decision: Marketplace publication runs in a dedicated workflow, separate from CI.
- Rationale: preserves the existing CI role as continuous validation and isolates publish permissions.
- Alternatives considered: publishing directly from CI. Rejected because it couples routine validation with privileged deployment.

### REL-003

- Date: March 18, 2026
- Status: Approved
- Decision: manual release fallback is allowed only for an existing tag and matching GitHub release.
- Rationale: keeps fallback execution auditable and prevents ad-hoc publishing from arbitrary commits.
- Alternatives considered: free-form manual publish inputs. Rejected because they bypass release traceability.

### REL-004

- Date: March 18, 2026
- Status: Approved
- Decision: publisher identity is supplied through repository variable `JSM_MARKETPLACE_PUBLISHER`, while `VSCE_PAT` stays environment-scoped.
- Rationale: publisher identity is required for packaging but is not secret; the token is secret and must stay protected until publish approval.
- Alternatives considered: committing a placeholder `publisher` value to `package.json`, or storing publisher identity as a secret. Rejected because the repo does not yet define a real publisher and the value is not confidential.

### REL-005

- Date: March 18, 2026
- Status: Approved
- Decision: failed or partial releases use a forward-fix-only recovery model.
- Rationale: Marketplace version overwrite rollback is not supported and deterministic recovery is easier to audit.
- Alternatives considered: rollback by overwrite or silent unpublish. Rejected because they either are not supported or create ambiguous recovery history.
