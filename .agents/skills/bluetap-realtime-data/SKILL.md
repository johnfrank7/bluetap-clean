---
name: bluetap-realtime-data
description: Preserve BlueTap role-layout data providers, deduplicated Firestore listeners, cached navigation state, and safe subscription cleanup.
---

# BlueTap Realtime Data

Keep realtime reads scoped to the signed in role and its authoritative ownership fields.

- Mount long-lived Requester, Distributor, and Manager data subscriptions at their role layout. Route screens consume the shared cache instead of recreating equivalent Firestore listeners after every navigation.
- Deduplicate subscriptions by Firebase Auth UID and, for Manager data, the trusted session branch. Multiple consumers may subscribe to one registry or context, but they must share one underlying listener per query.
- Deliver cached data immediately while a listener reconnects. Do not clear valid screen data merely because the user navigated between tabs.
- Dispose auth, profile, order, branch, and timer subscriptions on logout, account change, provider unmount, or the final subscriber's idle cleanup. Never let one account receive another account's cached records.
- Requester order queries use `requester_id == request.auth.uid`. Distributor queries require both `assignedDistributorUid == request.auth.uid` and the Distributor's authoritative active `branchId`. Manager queries remain limited to the trusted assigned branch, with a separate query for pending incoming transfers.
- Firestore listeners are read-only UI synchronization. Order creation, assignment, approval, scheduling, delivery, cancellation, account changes, and other business mutations remain protected backend actions.
- Prime shared caches after successful backend mutations for immediate feedback; allow the authoritative Firestore snapshot to reconcile the result.
- Treat listener errors as recoverable. Retain the last safe cache, expose a retry path where useful, and avoid reconnect loops or duplicate fallback listeners.
- Keep realtime security and UI refresh separate: RoleGate revalidates access when the signed in profile changes, while backend authorization remains authoritative for every privileged request.
