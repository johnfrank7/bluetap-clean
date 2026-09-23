---
name: bluetap-agent-handoff
description: Safely continue BlueTap work across coding agents, machines, or interrupted sessions without overwriting valid changes, duplicating architecture, or weakening security.
---

# BlueTap Agent Handoff

Repository-scoped instructions are authoritative: `AGENTS.md` and `.agents/skills/`. Local Codex, Antigravity, or other agent instructions may supplement them but must not silently override BlueTap architecture or security rules.

## Before work

Before editing, inspect:

```text
git status --short
git branch --show-current
git log -1 --oneline
git diff --stat
git diff
```

Then read `AGENTS.md` and every relevant repository skill. Understand the current branch, latest commit, uncommitted work, applicable architecture, and previous agent changes before making edits.

## Preserve existing work

If the working tree is dirty, inspect the diff and assume it may belong to the user or a prior agent. Do not automatically run `git reset --hard`, `git checkout .`, `git restore .`, `git clean -fd`, revert files, or overwrite modified files from `HEAD`. Preserve work unless its removal is explicitly approved.

Do not have two agents actively edit the same working tree. For parallel work, use separate branches or worktrees such as `codex/<task>` and `antigravity/<task>`.

When continuing after a usage limit or interruption, inspect the working tree and prior visible report/specification, determine what is complete, and continue from that state. Do not restart a feature, duplicate APIs or components, or redesign working code without evidence that the existing implementation cannot satisfy the task.

## UI and diff safety

Before major UI work, compare against the current committed version or known last-good commit. “Replace demo data” means preserve valid UI and replace the data source; it does not authorize deleting or rewriting the page.

Stop and inspect an unexpectedly large rewrite or deletion for a focused task. Classify deleted lines as demo/mock data, duplicate/obsolete code, or real functionality/UI. Restore real functionality/UI unless deletion was explicitly requested.

## Architecture and security

Preserve the repository architecture and its relevant skills. Do not introduce parallel authentication systems, branch-ownership models, registration flows, API clients, theme providers, order-state models, storage providers, or face-verification pipelines without proving the existing one is insufficient.

Agent switching must never weaken Firebase Authentication, Admin/Manager authorization, branch scoping, Distributor assignment security, Firestore rules, server-authoritative order mutations, the `requestedBranchId` versus operational `branchId` boundary, or secret handling. Never temporarily bypass security to make a feature work.

Repository skills under `.agents/skills/` are the portable source of truth. When a durable architecture or workflow rule is discovered, update the relevant repository skill; do not update only a machine-local copy. Create skills only for genuinely separate, durable domains—not one-off bugs. Chat remains deferred until explicitly implemented.

## Commit, push, and handoff

Before a commit, run:

```text
npm test
npm run build
git diff --check
```

Then inspect `git status --short`, `git diff --stat`, and `git diff`; confirm expected files only, no accidental feature deletion, no secrets, and no unrelated changes. Keep logically separate work in separate commits and do not amend earlier commits unless explicitly requested.

Never commit `.env` files, service-account JSON, Firebase Admin keys, Gmail App Passwords, Supabase service-role keys, API secrets, tokens, or private certificates. Never place server secrets in `EXPO_PUBLIC_*`. Perform a secret audit before every commit.

Push only with explicit user approval or an active task that explicitly authorizes it. Never force-push `main` or rewrite shared history without explicit approval.

At handoff, report completed and pending work, files changed, affected backend/frontend/rules, tests, build, diff check, commit SHA, push state, required deployments, known bugs, and updated skills. Distinguish GitHub push status from Render, Vercel, Firestore-rules, and Expo/native deployment state.
