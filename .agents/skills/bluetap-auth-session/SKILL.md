---
name: bluetap-auth-session
description: Preserve BlueTap public and privileged login, trusted profile reuse, session handoff, RoleGate validation, and safe authentication error routing.
---

# BlueTap Auth and Session

- Allow one login request per submission and prevent double-click duplicates.
- Reuse the safe backend-returned profile for public-login routing; do not add a duplicate `users/{uid}` read.
- Fresh Admin credential login may force-refresh once at most. Manager enters through the public custom-token login and must not force a second unnecessary refresh.
- RoleGate reuses shared validated session state. Do not introduce auth/token-refresh or login/dashboard redirect loops.
- Reuse a successfully validated Admin session across Admin navigation. Do not force-refresh a token, repeat the Admin claim/profile read, or block every route transition; deduplicate concurrent validation while keeping server-side endpoint authorization authoritative.
- Map public errors distinctly: `INVALID_CREDENTIALS`, `PRIVILEGED_LOGIN_REQUIRED`, `NETWORK_ERROR`, and `SERVER_ERROR`. Public `PRIVILEGED_LOGIN_REQUIRED` identifies Admin accounts only and offers the Administrator portal.
- Public `/login` is the single authentication entry for Requester, Distributor, and Manager accounts. Manager has no separate authentication portal; `/manager/login` is redirect-only compatibility. Admin remains separate at `/admin/login`.
- Requester, Distributor, and Manager session expiry returns to `/login`; Admin session expiry returns to `/admin/login`.
- Configure Requester, Distributor, and Manager idle timeouts, absolute session lifetimes, and password-change session revocation through Admin **Security Settings**. Use one warning/idle/absolute timer set per mounted role guard, sign out through Firebase, and redirect to the correct role login.
- An Admin temporary-password reset sets `mustChangePassword = true`. Preserve the restricted forced-password flow and correct post-change role destination for Requester, Distributor, and Manager accounts.
- A Manager using an Admin-issued temporary password authenticates on `/login`, completes `/required-password-change`, and proceeds to the Manager dashboard only after normal Manager authorization succeeds.
- A per-user idle-timeout override is optional and falls back to the server-sourced role default from Security Settings. Do not copy global policy into profiles or let a client-only override control an active session.
- Admin temporary-password resets may require a password change on next sign-in and must not expose or store a current/plaintext password outside Firebase Auth.
- Session revocation remains server-authoritative through Firebase refresh-token revocation; account UI never handles tokens.
- A stale login error must never overwrite a completed trusted authentication; maintain one submission pipeline and ignore superseded completion/error callbacks.
- Password recovery uses a distinct, verified, short-lived recovery authorization. A completed recovery updates Firebase Auth server-side, revokes prior refresh tokens, and still routes only through normal role, onboarding, and status rules.
- Login throttling is primarily account/identifier scoped, with a separate higher-threshold IP abuse limiter. A normal per-account cooldown must not globally block unrelated BlueTap accounts.
