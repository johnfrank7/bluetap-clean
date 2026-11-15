# Phase 3 Batch A account-action architecture

## Batch A implementation boundary (October 25, 2026)

The standalone Admin `deactivate`, `suspend`, and `terminate` actions now use
this intent and reservation model. Authorization atomically writes a separate
`accountAccessHolds/{uid}` record and a protected profile marker before Auth is
called. The marker blocks protected backend and Firestore client access while
`accountStatus` still records the pre-action state. Termination disables Auth;
it does not delete the user. Suspension and termination require a bounded,
factual Admin reason, included in the intent payload identity and final audit.

The request-driven executor obtains a bounded lease, rechecks a current Admin,
the target, reservation, and hold, observes Auth, calls `updateUser` only when
needed, and requires an acknowledged `revokeRefreshTokens` call plus an observed
disabled Auth user before transactional profile/audit finalization. Unknown
external or Firestore results remain pending. A current Admin can inspect and
retry the exact intent through Accounts & Audit. Lease expiry does not release
the reservation, and a retry after expiry observes Auth before further work.

The reservation remains after finalization. A later, settled reactivation may
atomically hand it to a new intent; an unresolved external Auth invocation
blocks that handoff. The ordering-abuse account-action hold remains in force.
There is no Appeals route in Batch A.

## Final Batch A continuation

Chat-report `suspend_account` and `terminate_account` now use the same durable
reservation, access hold, lease, Auth observation, and token-revocation path as
standalone Admin actions. Authorization rechecks a current Admin, active case,
canonical conversation participants, target role, and conflicting reservation
in one Firestore transaction. It reserves the moderation mutation ID and marks
the case pending before any Auth call. Successful finalization atomically writes
the canonical account status, immutable account audit and moderation action,
the suspension notice, and the resolved case. A timeout leaves the account held
and the case visible with a protected Admin retry action. Ordering-abuse account
actions remain held. Non-account moderation actions remain available.

Reactivation is available only for a settled inactive or suspended account.
Before each Auth update and token revocation, the executor records an external
flight marker in the intent. It clears the marker only after the Promise has
returned. A late old call therefore blocks reservation handoff, even after its
Firestore lease expires. The reactivation intent takes over the reservation
and access hold, verifies Auth is enabled, then atomically restores canonical
active status, removes the hold, and creates one deterministic audit record.
Pre-marker legacy intents and any unknown in-flight Auth result require manual
recovery. Terminated accounts remain outside this reactivation workflow.

## Targeted release-blocker review (October 25, 2026)

The real Firestore/Auth emulator now covers a chat case closing while account
authorization is in progress, two Admins reserving different chat cases against
one account, and a delayed Auth disable finishing after its executor lease has
expired. These tests exercise the shared durable path; they do not prove that
Auth and Firestore can be committed atomically. The latter test demonstrates why
the retained reservation and access hold are necessary: the old Auth call can
still finish, while its stale executor cannot finalize and reactivation remains
unavailable. A lease timeout is not evidence that an Auth request has stopped.

`/api/moderation/notices` still requires `verifyIdToken(token, true)` and is
unavailable after disablement. Before an Auth disable, the executor now sends
a factual initiation notice to the Firebase Auth verified email that matches
the server-owned profile. The existing Resend or Vercel relay provider must
return a successful acceptance response first. The intent records a stable
request ID, recipient hash, provider and acceptance time. Acceptance is not
proof of inbox delivery or reading. No provider response, failure, or timeout
leaves the action pending with the notice state `sending`; an exact retry does
not resend through the non-idempotent relay. Existing in-app notices remain.
Known missing provider configuration is rejected during authorization before
the reservation or hold is written. This does not prove the live provider is
reachable; an outage after authorization still needs manual reconciliation.
Accounts without an Auth-verified email that matches the profile, including
newly Admin-provisioned accounts until verified, cannot start a full disable
action through this workflow. No notice is sent to an unverified address.

The affected **uncommitted** paths are Admin Accounts & Audit
`deactivate`/`suspend`/`terminate`/`reactivate` and Admin chat-report
`suspend_account`/`terminate_account`, including exact-intent retries.
Deactivation uses the same pre-disable email notice. The ordering-abuse hold
remains in force. Temporary ordering restrictions retain login and appeal
access; they are not full account suspension. Termination disables rather than
deletes Firebase Auth. Non-account chat moderation remains available.

For recovery, inspect the exact intent, reservation, hold, profile, audit,
notice state and Auth disabled state. Retry only the same pending intent under
current Admin and case authority. A `sending` notice or non-null external
flight marker must not be retried as a fresh email/Auth call. Keep the hold and
reservation, stop conflicting actions, and escalate to an operator who can
establish an exclusive Auth-operation boundary and confirm the external call
has ended. Only after that proof may the operator reconcile records and
re-observe Auth. A lease expiry, elapsed time, or one Auth read is not proof;
never remove a hold or enable Auth on that basis. Without proof, leave the
account restricted. Do not manually mark provider acceptance without evidence.

## Durable authority and lifecycle

The live Admin Accounts & Audit and Admin chat-report handlers call the
server-only intent service. A revocation-checked Firebase token and current
Admin profile establish authority; client-supplied role or branch does not.
Chat-case authorization also checks the current report, canonical conversation
participants, target, and case relationship inside the transaction. The
ordering-abuse suspension and termination path remains disabled.

`accountActionIntents/{intentId}` stores the normalized action identity,
payload hash, actor and target UIDs, source, revision, lease, Auth observation,
notice state, and reconciliation markers. `accountActionReservations/{targetUid}`
serializes actions against one account. `accountAccessHolds/{targetUid}` and the
server-owned `users/{uid}.accountActionHoldIntentId` marker block protected
access during an unresolved action. Firestore rules deny direct client access
to the intent, reservation, and hold collections and prevent clients from
changing the profile marker. An exact replay uses the existing intent; a
changed payload conflicts. The reservation has no timeout-based release.

| State | Current behavior |
| --- | --- |
| `authorized` | The intent, reservation, and hold are durable; no Auth success is asserted. |
| `applying` | A bounded executor lease permits observation and guarded external calls. |
| `reconcile_required` | An external result is uncertain; the hold and reservation remain. |
| `applied` | Auth state was observed and the canonical profile and audit were finalized. |

The request-driven executor rechecks authority and the case, records a flight
marker before each Auth mutation, observes Firebase Auth, and prevents an old
lease owner from finalizing. Disable actions require provider acceptance of the
notice before `updateUser({ disabled: true })`; finalization requires an
observed disabled user and acknowledged refresh-token revocation. Reactivation
requires a settled inactive or suspended predecessor, observes enabled Auth,
and clears the hold only in the final transaction. Terminated accounts are not
eligible. A failed request or process restart does not itself undo an intent.

## Staging and recovery limits

Batch A uses the existing Resend transport when `EMAIL_PROVIDER=resend`; the
registration OTP sender and template remain separate. Provider acceptance is
recorded, but actual inbox arrival has not been verified on a nonproduction
account. The staging deployment must use the staging Firebase project, Web
key, service account, backend, and authorized Resend sender and recipient.

An uncertain notice in `sending` state must not be resent automatically.
An uncertain Auth flight must not be treated as stopped merely because its
lease expired. The protected retry path can re-observe safe settled work; cases
without evidence that the external operation ended require operator review
while the hold remains. The live implementation has no always-on worker and
does not promise automatic recovery after a Render process restart. A real
staging provider-acceptance and inbox-delivery test is still required before
claiming end-to-end notification delivery.
