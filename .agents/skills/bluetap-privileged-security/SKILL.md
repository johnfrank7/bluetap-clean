---
name: bluetap-privileged-security
description: Preserve BlueTap Admin and Manager authorization, Super Admin separation, branch-scoped management, and privileged session security.
---

# BlueTap Privileged Security

Roles are `admin`, `manager`, `distributor`, and `requester`. The former operational Admin is now Manager; Super Admin is separate.

- Admin authorization requires Firebase Auth, an Admin custom claim, and `users/{uid}.role === "admin"`.
- Only Admin may read or modify Admin-only registration-security settings; Manager, Requester, and Distributor access remains forbidden.
- The unified **Security Settings** workspace is Admin-only. Session-policy changes use the same server-authoritative authorization and audit guarantees as registration-security changes.
- Treat the persisted backend registration-security policy as authoritative. Client toggle state is only an editable draft and must never grant, remove, or prove a security requirement.
- Frontend omission of a disabled security step never overrides backend enforcement. Backend authoritative policy remains the final security gate.
- Audit every registration-security change with the actor UID, previous and new verification settings and limits, and a timestamp. Never include credentials or secrets.
- Manager is scoped to an assigned active branch; keep branch assignment enforcement on the backend.
- Notification convenience must never broaden Manager branch authorization. Raw Firestore permission errors must not be solved by collection-wide Manager read access.
- Manager authentication uses the shared public `/login` flow. Manager authorization still requires the trusted Firebase claim, `users/{uid}.role === "manager"`, active Manager status, and an assigned active branch on the server.
- Admin authentication remains separate at `/admin/login`; public login must reject Admin accounts without weakening credential-error privacy.
- Do not permit client-side role escalation.
- The hidden multi-click Admin login is navigation only, never authorization.
- Admin/Manager login and session changes must not create token-refresh loops.
- Accounts & Audit is Admin-only. The general provisioning form cannot create Admin accounts, sensitive account actions remain server-authoritative, and account mutations write safe audit events without credentials or secrets.
- Every Admin account edit is backend-authorized and validates the target UID, safe field changes, role transition, active Manager branch, Distributor workflow state, session override, and activation transition.
- No general account UI or API may create or escalate an account to Admin. Manager branch assignment and Distributor approval state remain protected server-side workflows.
- Only trusted Admin backend actions may write a Distributor's operational `branchId`, `distributorStatus`, approval/rejection metadata, or requested-branch metadata. Firestore client rules must reject those fields from the Distributor and Manager clients.
- Manager may view branch-relevant public Distributor applications where rules permit `requestedBranchId == current Manager branchId`, but Admin remains authoritative for approval and rejection unless backend policy explicitly changes. Application visibility never grants branch order ownership or dispatch authority.
- Approving a pending Distributor must atomically validate Admin authority, pending Distributor status, and the target active branch before writing `distributorStatus: "active"`, `branchId`, and approval metadata. Preserve requested-branch history; rejection clears `branchId` while preserving the request and safe reason.
- Admin Accounts & Audit exposes active branch assignment and branch-change auditing. It must not permit a Distributor to self-assign or a Manager to impersonate the Admin branch-assignment workflow.
- Audit every sensitive account change with safe before/after metadata; never record passwords, tokens, OTP values, or biometric data.
- An operational Distributor (approved, active, branch-assigned, no mustChangePassword) may read **only its own authoritative assigned branch document** (`branches/{branchId}` where `branchId == currentUser().branchId`) for branch-scoped display or operations. The Firestore rule grants this via `isDistributor() && branchId == currentUser().branchId`. `requestedBranchId` **never** satisfies this check — it is a pending-approval field only. Branchless, pending, or unapproved Distributors are blocked by `isDistributor()` which requires `branchId is string` and an active approval status. Branch listing, creation, update, and deletion remain `false` for all clients.
- Public UID identity separation: Human-friendly Public UIDs (`Req001`, `Dis001`, `Man001`, `Adm001`) generated from atomic transactions on `accountCounters/{role}` are strictly immutable display identifiers. Internal Firebase Auth UID remains the sole authoritative identity for authentication, security rules, and authorization. Public UIDs must never be used or trusted as security credentials or session tokens. Legacy `Mgr###` values migrate server-side to the same-number `Man###` form.
- Clients format and display only persisted Public UIDs. They must never query or update Public UID counters, synthesize a replacement from Firebase Auth UID, or render raw Firebase Auth UID in product UI. Use the protected Admin UID backfill workflow for legacy accounts missing a Public UID.
- Manager self-profile editing is limited to approved personal fields. Branch, role, publicUid, status, and privilege fields remain server-controlled.
- Admin Distributor Override security: When Admins exercise emergency dispatch override, the backend enforces same-branch ownership (the target distributor's `branchId` must match the order's `branchId`), blocks cross-branch dispatch attempts with HTTP 403, and records an append-only audit entry in `assignmentHistory` with `event: 'ADMIN_DISPATCH_OVERRIDE'` containing the Admin actor UID and mandatory justification reason.
- Admin override Distributor selection remains restricted to eligible active Distributors from the authoritative fulfillment branch. The backend checks status, branch, and scheduled weekday even when the UI filters choices.
- Managers may update product delivery-rule overrides only for their server-authoritative `manager.branchId`; client-supplied branch identifiers never select the write target and global Admin defaults remain immutable to Managers.
- Public UID migration/backfill remains an Admin-authorized, server-side, deterministic, idempotent, audited workflow that preserves the oldest valid unique assignment and never derives a display identifier from a raw Firebase Auth UID.

## Moderation authority

- A Manager may list and act only on chat reports and ordering-abuse reviews whose server-derived jurisdiction matches the Manager's current active branch. Manager actions are dismiss, warn, 1/3/7-day branch chat restriction, 1/3/7-day branch ordering restriction, and escalation. Managers cannot apply platform restrictions, suspend an account globally, terminate an account, or reactivate an account.
- Admin moderation may apply warnings, platform chat or ordering restrictions, canonical account suspension, termination, and eligible reactivation. Account actions must use canonical `accountStatus`, update Firebase Auth disabled state, revoke sessions for suspension/termination, and remain retry-safe through a stable mutation record.
- Ordering restriction authority follows the same split: Manager restrictions are branch-only and Admin restrictions are platform-wide. Client-supplied role, target UID, or branch never establishes moderation authority.
- Moderation actions and expanded chat reviews write append-only safe audit records. Private moderator notes never enter user notices or ordinary logs. Terminated accounts are not reactivated through the suspended/inactive reactivation path.
- Admin moderation remains report- or abuse-review-scoped. It must never become a global chat inbox, conversation browser, search, or export surface.

## System Maintenance retention boundaries

- System Maintenance currently owns Data Retention & Cleanup only. It must not become a generic destructive reset surface.
- Retention distinguishes ephemeral, operational, and historical records. Hard deletion is limited to verified expired ephemeral records; terminal authoritative orders are archived in place.
- Automated cleanup must never delete user identities, public UID counters, branches, authoritative historical orders, financial snapshots, security configuration, or Admin audit records.
- Preview Cleanup is server-authoritative and non-mutating. The backend selects supported cleanup categories, validates safe policy values, recomputes eligibility before execution, and rejects client-selected collections.
- Historical performance problems should first be addressed through bounded queries, pagination, and scoped realtime listeners. Data deletion is not a substitute for correct query design.

## Phase 4.1 moderation state

- Reports & Safety uses `active` for open plus escalated reports. A Manager warning remains actionable so a later escalation appends history and leaves the final state escalated. Managers cannot use platform/account actions; Admin has no global Messages inbox and expanded context always requires an audited reason.
- Moderation timestamps returned to clients are ISO strings. Reporter identity and private moderator notes never appear in target-user notices.
