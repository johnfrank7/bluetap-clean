# Dispatch guard reconciliation: local evidence and rollout prerequisites

This is a plan, not authorization to access production. The reconciliation module is restricted to `127.0.0.1:8080` and project `demo-bluetap`; it is not a production migration command. No production inventory, writes, deployment, or rollback was performed in this batch.

## Emulator reconciliation contract

`createEmulatorReconciler()` inventories Distributor profiles, including those with no active orders, and active order assignments. Its per-Distributor transaction reads the profile, guard, and the entire `requests` collection before writing only the guard. A canonical and legacy field naming the same UID count once. A conflicting or malformed identity, unknown assignee, unrecognized or inconsistent assignment status, branch mismatch, absent or malformed schedule, more than five active assignments, or a known overlap of less than 30 minutes blocks initialization and reports the affected IDs. An explicit `null` schedule is retained as unscheduled; it is never inferred from malformed data. An `accepted` order without an assignee is reported for review because its history may represent either an unassigned order or missing assignment data.

Missing guards are created only after the transaction validates its snapshot. Identical valid guards are left unchanged. A malformed guard or one with unexplained extra reservations is reported without modification. Repair of another stale but valid guard requires a prior preview's exact guard revision, Firestore update-time token, and proposed-order hash; a changed guard or order plan is rejected. No order, chat, delivery-attempt, or audit record is written by the tool.

The emulator implementation deliberately scans all requests per Distributor to detect records with an unknown assignee. It is an isolated correctness prototype, not a scalable production backfill. Its checks do not make old, guard-unaware writers safe: guard-aware transaction coordination and a controlled write pause remain prerequisites for any future rollout.

## Measured query behavior

In a local Firestore emulator, synthetic histories contained four active orders, 500 unrelated delivered orders, and the indicated number of delivered orders for one Distributor. Each historical order had both assignment fields. Times are local observations, not production latency or billing measurements.

| Delivered history for Distributor | Current two-query snapshots | Candidate OR-query snapshots | Approximate current transaction document snapshots | Current transaction samples, ms | Full reconciliation scan: request documents / ms |
| ---: | ---: | ---: | ---: | --- | --- |
| 0 | 8 | 4 | 11 | 74, 96, 115 | 505 / 90 |
| 100 | 208 | 104 | 211 | 74, 90, 94 | 605 / 75 |
| 1,000 | 2,008 | 1,004 | 2,011 | 132, 136, 154 | 1,505 / 97 |
| 3,000 | 6,008 | 3,004 | 6,011 | 273, 296, 299 | 3,505 / 157 |
| 10,000 | 20,008 | 10,004 | 20,011 | 617, 674, 704 | 10,505 / 418 |

The candidate OR query returned each matching order once and retained both canonical and legacy matches in the emulator. It was not applied to the runtime guard: production index support could not be verified in this batch. Both approaches still read the Distributor's delivered history and filter status in application code, so transaction work grows with that history. A Manager assignment also performs its existing canonical precheck; reassignment may check two guards. The full reconciliation scan grows with the entire requests collection for every Distributor. Real production practicality, latency, lock contention, quotas, and billing remain unverified.

The current runtime queries are two single-field equality predicates. `firestore.indexes.json` declares no field exemptions. The emulator could not provide query-explain results, and it [does not enforce composite indexes](https://docs.cloud.google.com/firestore/native/docs/emulator); Firebase states that [OR queries require suitable indexes](https://firebase.google.com/docs/firestore/query-data/queries). The actual production index configuration and query plan must be confirmed separately before adopting the candidate. Filtering by status would change behavior for legacy status representations unless their normalization and indexing are first verified, so this batch does not add that filter.

## Future rollout sequence

1. Obtain separate authorization for a production inventory and migration design. Inventory every Distributor, including zero-assignment accounts, and all active orders. Resolve unknown assignees, conflicting identity fields, unscheduled ambiguity, branch mismatches, malformed guards, over-capacity cases, and known schedule conflicts without deleting historical records.
2. Pause and drain all assignment, reassignment, rescheduling, release, and Distributor eligibility or branch-change writers, including older backend instances and administrative jobs. Verify no in-flight or automatically restarted old writer remains. Preserve a recoverable snapshot.
3. With a separately reviewed production-capable backfill, initialize from verified authoritative orders, including explicit known unscheduled reservations. Do not initialize an empty guard merely because a partial query returned nothing. Existing guard repairs require a reviewed before/after plan and concurrency protection; unresolved cases stay blocked.
4. Independently compare every guard against authoritative orders and profiles, including legacy fields, counts, schedules, and branch ownership. Do not enable assignment increases while any affected guard is missing, stale, malformed, over capacity, or unresolved.
5. Activate only guard-aware backend instances after old instances are fully drained. Re-enable writes in a controlled manner and monitor guard-invalid, capacity, schedule, contention, and transaction-failure responses. Establish how newly provisioned Distributors receive verified guards before enabling their assignments; this batch does not implement provisioning.
6. For rollback, pause and drain writers again. Never run old guard-unaware writers alongside guard-aware writers. Preserve guards and source records, review the state, and perform a new full reconciliation before any subsequent activation.

Firestore can serialize participating writes through the guard and account documents. Firebase Auth is a separate service: an external Console disable or other out-of-band change cannot be made atomic with Firestore, and requires separately designed detection and reconciliation. Account-action holds initiated through BlueTap must remain enforced.
