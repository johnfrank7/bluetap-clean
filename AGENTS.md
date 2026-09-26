# BlueTap repository guidance

This repository is BlueTap. Before substantial work, inspect the relevant skill under `.agents/skills/` and the existing implementation.

- Preserve the existing architecture and role isolation. Firebase Authentication is the authentication authority; Firestore stores application data; authoritative business actions remain server-side.
- Keep Manager actions branch-scoped and do not trust client-supplied branch or role fields.
- Never commit secrets, `.env` files, service-account JSON, private keys, tokens, or credentials.
- Diagnose the root cause before refactoring. Prefer focused changes, preserve role-specific routes and layouts, and protect valid UI from destructive rewrites.
- Before continuing work created by another coding agent or entering a dirty working tree, read `bluetap-agent-handoff` and inspect Git status and diff first.
- After substantial work run `npm test`, `npm run build`, and `git diff --check`.
- Before committing, inspect `git diff` for unexpected large deletions. Do not push without explicit approval.

## Skill index

| Task | Skill |
| --- | --- |
| Authentication and sessions | `bluetap-auth-session` |
| Registration and onboarding | `bluetap-registration-flow` |
| Admin or Manager authorization | `bluetap-privileged-security` |
| Requester orders, branches, location, dispatch | `bluetap-ordering-and-location` |
| Face verification | `bluetap-face-verification` |
| Deployment and environment boundaries | `bluetap-backend-deployment` |
| Admin or Manager UI | `bluetap-ui-design` |
| Requester or Distributor portal UI | `bluetap-user-portal-ui` |
| Agent switching, interrupted work, or a dirty tree | `bluetap-agent-handoff` |
| Multi-file edits, disk validation, and parser stability | `bluetap-edit-stability` |
| Realtime role data, caches, listeners, and cleanup | `bluetap-realtime-data` |
