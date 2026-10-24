# Phase 3.1E-0D-1 account-action foundation

`accountActionIntentService.js` is server-only and is not called by a live route.
This slice reserves an account and records an authorized intent. It never changes
Firebase Auth, `users/{uid}.accountStatus`, or the target's access. Firestore and
Firebase Auth cannot be committed atomically; an Auth timeout is **unknown**, not
proof that an operation failed.

## Current authority and race boundary

The live chat-case moderation path and standalone Admin Accounts & Audit path
currently call `auth.updateUser` (and, for disabling, `revokeRefreshTokens`)
before committing Firestore status and audit data. A crash or timeout between
those steps can leave Auth and Firestore inconsistent. The existing ordering-abuse
`suspend_account` and `terminate_account` hold remains in force. None of these
live paths reads the new reservation yet, so this foundation alone does not
prevent a live chat or standalone action from racing a pending intent. It is
not a claim that the existing paths are repaired.

## Durable records

`accountActionIntents/{sha256(["account_action_intent_v1", actorUid,
clientMutationId])}` contains schema version, exact actor and target Auth UIDs,
target role, action, source category, `caseRef`, `validatedGrounds`, normalized
payload hash, mutation-ID hash, desired Auth-disabled value, lifecycle state and
revision, reservation ID, lease, observation, reconciliation summary, and
server-generated creation/update times. No token, password, private case note,
or raw client mutation ID is stored. In 0D-1, `source` must be `admin_account`;
`caseRef` is null and `validatedGrounds` is empty. Chat and ordering-abuse cases
must not use this entry point until their case authority and any incident
grounds are revalidated inside the same transaction.

`accountActionReservations/{targetUid}` contains the current intent ID and
stable target UID. It is not a lease and has no expiry. Rejected requests write
neither document. New incompatible intents conflict while the reservation
exists. Exact replay returns the existing intent without writes. A changed
payload under the same actor/mutation ID conflicts. Authorization is derived
from a revocation-checked Firebase token plus current Admin profile read in
the same transaction as target, intent, and reservation reads. All reads precede
writes. Target-role and current-status checks are server-side.

## State and future executor contract

| State | Meaning | Allowed next step |
| --- | --- | --- |
| `authorized` | Durable authority and reservation; no Auth work asserted | Lease claim -> `applying` |
| `applying` | Executor owns a lease; Auth result is not yet durable | Observe and finalize, or mark `reconcile_required` |
| `reconcile_required` | Prior execution may have reached Auth | New lease, then **observe Auth before any mutation** |
| `applied` | Observed Auth and canonical Firestore state agree | Terminal; later exact replay only |
| `failed` | Definitive non-application established and audited | Terminal; later exact replay only |

Only `authorized -> applying`, expired `applying -> reconcile_required`, and
lease renewals are implemented in 0D-1. Claim and renewal always read and
verify the reservation. A lease's expiry or process restart never removes the
reservation. Every claim increments a generation; stale owners cannot renew.
The `applied` and `failed` transitions are deliberately **not implemented**.
Only a future observed finalizer may replace/release a reservation; it must
atomically recheck intent generation, reservation identity, actor/case policy,
Auth observation, canonical account state, and audit changes. A timeout or
network error must enter reconciliation, never `failed`.

Future executor interface, with no always-on Render worker dependency:

1. `claimIntentLease({ db, intentId, ownerId, now, leaseMs })` or
   `renewIntentLease({ db, intentId, ownerId, generation, now, leaseMs })`
   gives a bounded owner/generation. These two Firestore-only operations exist.
   The lease alone is not action authority: before any Auth call, the executor
   must recheck current actor privilege, target identity/status, source case,
   validated grounds, and reservation under the then-current policy.
2. Future `observeAuth({ auth, targetUid }) -> { disabled, observedAt,
   revocationEvidence }` reads current Auth state. No observation or mutation
   occurs inside a Firestore transaction.
3. Future `applyDesiredAuthState({ auth, intent, observation })` compares the
   observation with `desiredAuthDisabled` and issues only required idempotent
   Auth work. Future `recordObservation({ db, intentId, ownerId, generation,
   observation, errorClass })` must reject stale ownership and preserve the
   reservation. Unknown results must be observed again on retry.
4. Future `finalizeObservedIntent({ db, intentId, ownerId, generation,
   observation })` transactionally validates the reservation and observation,
   writes canonical profile state plus immutable audit, then resolves the
   reservation. It must never accept a caller's unverified success assertion.
5. Future `resumePendingIntent({ db, auth, intentId, ownerId })` must first
   obtain a lease and observe Auth. A durable trigger (request-driven
   reconciliation or a separately scheduled
   invocation) must resume pending intents after process restart. Render's
   current deployment is a web service, not a guaranteed persistent worker.

## Account-access hold required before live integration

0D-2 must introduce an independent server-owned `accountAccessHolds/{uid}`
projection before any pending disable can execute. Creation of an authorized
disable intent and its access hold must be in one Firestore transaction; rejected
requests create no hold. The hold must deny protected backend API access and
Firestore client access, including reads from an already-issued token, without
setting `accountStatus` to `suspended` or `terminated` before Auth completion.
Firestore `hasActiveGlobalAccount` and all backend role gates need an exact hold
check; sensitive operations using an earlier guard also need a transaction-time
check. A pending enable/reactivation must not clear a prior disable hold until
the old intent is observed and finalized. Hold removal, canonical status update,
and reservation handoff must be coordinated transactionally in 0D-3.

Policy to settle before 0D-2/0D-3: which disabled actions receive an immediate
hold; how an Admin can recover a permanently uncertain intent; whether
terminations are reversible; what evidence proves token revocation; and how
legacy chat-case and standalone Admin actions are migrated without bypassing
reservations. The current foundation rejects all case-linked requests and
keeps a reservation until a future observed finalizer exists.
