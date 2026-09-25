---
name: bluetap-edit-stability
description: Enforce edit stability, direct disk verification, and safe multi-file modification practices across BlueTap.
---

# BlueTap Edit Stability

Follow these strict rules for all multi-file feature, refactoring, and bug fix work in BlueTap.

## 1. Small Patch Rule
Never rewrite an entire large component when a localized patch is enough.

Prefer:
- Small functions
- Small JSX sections
- Existing helpers
- Existing services

Avoid mass replacement of files like:
- `request.jsx`
- `requestform.jsx`
- `LocationMap.jsx`
- Dashboards (`r_dashboard.jsx`, `d_dashboard.jsx`)
unless absolutely necessary.

## 2. Disk Is Source of Truth
External writes can desynchronize IDE editor buffers.

Therefore:
- Validate files directly from disk using `@babel/parser` or Node test runner.
- Do not trust the IDE Problems pane alone.
- Stale editor diagnostics are not proof of broken source.

## 3. Parse Immediately After Editing
After modifying a JS/JSX file:
- Run a direct Babel parse on that file.
- Do not wait until the end of a 20-file batch.

If parse fails:
- Fix it before moving to another feature.

## 4. Batch Size
For risky multi-area work:
Work in phases of no more than a small logical group of files.

Example:
- Location -> parse / test
- Registration -> parse / test
- Manager dispatch -> parse / test
- UI gesture -> parse / test

Do not edit 20+ files first and verify only at the end.

## 5. Large Diagnostic Cascade Rule
If the editor shows dozens or hundreds of diagnostics:
- Inspect the first diagnostic / root parser error.
- Compare editor buffer line count to disk line count.
- Never fix every downstream symptom independently.

## 6. Dirty Buffer Safety
Never instruct the user to choose:
- Overwrite
- Revert
- Don't Save
until git status and disk state are verified.

If there is legitimate uncommitted work:
- Protect disk changes first.

## 7. No Concurrent Agents
Never let two agents edit the same working tree at the same time.

## 8. Verification Gate
Before claiming completion:
- `git diff --check`
- `npm test`
- `npm run build`
- Direct parse every changed JS/JSX file from disk.

All must pass.

## 9. Feature Completion Gate
Do not report "implemented" merely because files changed.

For every requested requirement report:
- COMPLETE
- PARTIAL
- NOT IMPLEMENTED
- BLOCKED

## 10. Editor Reload
Only after disk files parse and build successfully:
Recommend:
- Developer: Reload Window
- TypeScript: Restart TS Server

Never modify valid disk code merely to clear stale editor errors.

## 11. Git Safety
Do not commit or push until:
- User-requested features are verified.
- Parser is clean.
- Tests are clean.
- Build is clean.
- `git diff --check` is clean.

Never force push.
Never reset legitimate dirty work.
