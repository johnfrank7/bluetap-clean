---
name: bluetap-realtime-data
description: Preserve BlueTap role-layout data providers, deduplicated Firestore listeners, cached navigation state, and safe subscription cleanup.
---

# BlueTap Realtime Data

Keep realtime reads scoped to the signed in role and its authoritative ownership fields.

- Mount long-lived Requester, Distributor, and Manager data subscriptions at their role layout. Route screens consume the shared cache instead of recreating equivalent Firestore listeners after every navigation.
- Manager sidebar Requests, Distributors, and notification counts must derive from the same shared branch-scoped realtime data rather than independent page fetches. Manager order cards should render from that cache while optional dispatch metadata loads.
- Manager notifications should preferably derive from the same authorized, branch-scoped shared realtime data used by Manager operational pages. Avoid duplicate listeners or broader Firestore queries solely for notifications.
- Deduplicate subscriptions by Firebase Auth UID and, for Manager data, the trusted session branch. Multiple consumers may subscribe to one registry or context, but they must share one underlying listener per query.
- Deliver cached data immediately while a listener reconnects. Do not clear valid screen data merely because the user navigated between tabs.
- Dispose auth, profile, order, branch, and timer subscriptions on logout, account change, provider unmount, or the final subscriber's idle cleanup. Never let one account receive another account's cached records.
- Requester order queries use `requester_id == request.auth.uid`. Distributor queries require both `assignedDistributorUid == request.auth.uid` and the Distributor's authoritative active `branchId`. Manager queries remain limited to the trusted assigned branch, with a separate query for pending incoming transfers.
- Requester Dashboard and Active Orders/History consume `RequesterDataProvider`; do not recreate order listeners in those screens. Distributor and Manager protected reads use the same shared session readiness registry, including token/profile/branch readiness. Firestore optional profile fields must use safe defaults consistent with backend policy; accessing a missing field directly can deny otherwise valid reads.
- Firestore listeners are read-only UI synchronization. Order creation, assignment, approval, scheduling, delivery, cancellation, account changes, and other business mutations remain protected backend actions.
- Prime shared caches after successful backend mutations for immediate feedback; allow the authoritative Firestore snapshot to reconcile the result.
- Treat listener errors as recoverable. Retain the last safe cache, expose a retry path where useful, and avoid reconnect loops or duplicate fallback listeners.
- Keep realtime security and UI refresh separate: RoleGate revalidates access when the signed in profile changes, while backend authorization remains authoritative for every privileged request.
- Route navigation must not clear already-resolved shared data back to an initial skeleton state. Skeletons are for true first load; realtime refresh and background revalidation retain the last valid data.
- Registration step selection must not be unnecessarily gated by a cold privileged backend when a safe canonical public policy read model or prefetched policy exists. Cached policy only accelerates UI routing; backend registration-session and finalization policy remain authoritative.
- Do not create duplicate realtime listeners for the same role-scoped dataset. Persistent role-layout providers own shared subscriptions and route consumers read their cache.
- Operational realtime queries must remain bounded. Historical records belong in paginated, timeframe-specific, or explicitly on-demand views rather than unbounded listeners.
- While an order-detail surface is open, retain only its stable order ID and resolve the displayed record from the latest role-scoped live collection so lifecycle, assignment, totals, notes, schedule, and public UID changes appear without reopening the view.
