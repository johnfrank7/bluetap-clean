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
- Audit every registration-security change with the actor UID, previous and new verification settings and limits, and a timestamp. Never include credentials or secrets.
- Manager is scoped to an assigned active branch; keep branch assignment enforcement on the backend.
- Manager authentication uses the shared public `/login` flow. Manager authorization still requires the trusted Firebase claim, `users/{uid}.role === "manager"`, active Manager status, and an assigned active branch on the server.
- Admin authentication remains separate at `/admin/login`; public login must reject Admin accounts without weakening credential-error privacy.
- Do not permit client-side role escalation.
- The hidden multi-click Admin login is navigation only, never authorization.
- Admin/Manager login and session changes must not create token-refresh loops.
- Accounts & Audit is Admin-only. The general provisioning form cannot create Admin accounts, sensitive account actions remain server-authoritative, and account mutations write safe audit events without credentials or secrets.
- Every Admin account edit is backend-authorized and validates the target UID, safe field changes, role transition, active Manager branch, Distributor workflow state, session override, and activation transition.
- No general account UI or API may create or escalate an account to Admin. Manager branch assignment and Distributor approval state remain protected server-side workflows.
- Only trusted Admin backend actions may write a Distributor's operational `branchId`, `distributorStatus`, approval/rejection metadata, or requested-branch metadata. Firestore client rules must reject those fields from the Distributor and Manager clients.
- Approving a pending Distributor must atomically validate Admin authority, pending Distributor status, and the target active branch before writing `distributorStatus: "active"`, `branchId`, and approval metadata. Preserve requested-branch history; rejection clears `branchId` while preserving the request and safe reason.
- Admin Accounts & Audit exposes active branch assignment and branch-change auditing. It must not permit a Distributor to self-assign or a Manager to impersonate the Admin branch-assignment workflow.
- Audit every sensitive account change with safe before/after metadata; never record passwords, tokens, OTP values, or biometric data.
