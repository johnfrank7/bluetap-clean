---
name: bluetap-registration-flow
description: Preserve BlueTap's five-step signup, trusted registration-session state, policy enforcement, OTP flow, finalization, and account-limit behavior.
---

# BlueTap Registration Flow

Keep the flow: Account → Personal → Identity → Credentials → Verify.

- Face verification and Email OTP are independently configurable, but at least one must remain enabled. Enforce this invariant on the backend, not only in the client.
- Registration controls are presented within the unified Admin **Security Settings** page; the existing `/admin/registration-security` route may remain for compatibility.
- A disabled verification method is `not_required`; never represent it as successfully verified.
- When Face Verification is disabled (`faceVerificationRequired === false` in the session's security policy snapshot):
  - Step 3 (Identity) is bypassed or marked not required.
  - `completeRegistration` and `retryRegistrationFinalization` do not require `finalFaceImage` or pending face enrollment tokens.
  - Submitting a valid Email OTP finalizes account creation and returns the authentication token without throwing `face-capture-required` or `face-verification-required`.
  - When Face Verification is enabled, the presence of `finalFaceImage` and verified face session state remains strictly enforced before account creation.
- `registrationSession` is authoritative for an in-progress signup. Snapshot the active security policy into the session so later Admin changes affect new sessions without changing existing flows mid-registration.
- Enforce device and IP account limits server-side with transactions. Only finalized accounts consume permanent limits, and release temporary reservations after handled finalization failures.
- Enforce username uniqueness server-side and require Terms acceptance.
- Never log OTP secrets or plaintext values.
- Firebase Auth, profile, username registry, and face-enrollment finalization must be idempotent. Roll back partial finalization safely.
- Do not mark registration successful until every required record is complete.
- Password recovery OTPs are separate from signup verification: use a `PASSWORD_RESET` purpose and never reuse signup OTP records or registration sessions.

## Distributor branch applications

- The public Distributor branch picker must use the trusted backend list of active BlueTap branches; never hardcode or trust a browser-supplied branch name.
- A registration session may snapshot `requestedBranchId` and `requestedBranchNameSnapshot` only after backend validation. Include the requested ID in the session-bound personal digest so it cannot be swapped after identity verification.
- Public finalization creates a pending Distributor application with `distributorStatus: "pending"`, preserved requested-branch metadata, and `branchId: null`. A public signup never grants an operational branch assignment.
- Admin-created Distributors are a separate, immediate-active path: require and backend-validate one active branch at creation.
- Pending, rejected, and branch-unassigned Distributors must route to an appropriate status screen, not the Distributor operational portal. Only an active Distributor with a non-empty active `branchId` can enter operational routes.

## Username ownership lifecycle

- Treat availability checks as read-only backend checks. Typing, navigation, OTP requests, temporary face verification, and abandoned sessions must never create permanent username ownership.
- Normalize usernames on the server: trim, lowercase, and accept only 4–20 letters, numbers, or underscores. Use the normalized value for every registry lookup and claim.
- Create `usernames/{normalized}` only in the finalization transaction that marks the account complete. Re-check uniqueness atomically; the live availability result is UX only.
- On a finalization race, return `username-taken`, preserve the other owner, and send the applicant back to Credentials with an inline error.
- If finalization fails, retain or remove a mapping only when its ownership is proven to belong to that finalization; never delete another UID's mapping.
- Orphan cleanup defaults to dry-run and can delete only proven orphan username mappings. Verify mapping UID, Firebase Auth user, matching profile, and completed account state. A username mapping lacking an email field is normal and is never evidence of an orphan.
