# BlueTap documentation

Documentation is grouped by subject so implementation guidance stays close to the
part of the system it describes.

- [Technical documentation](architecture/TECHNICAL_DOCUMENTATION.md): project
  architecture, data model, flows, current limitations, and capstone notes.
- [Engineering context](architecture/BLUETAP_CONTEXT.md): concise repository and
  implementation context.
- [Active Vercel backend](backend/README.md): environment variables, API routes,
  registration flow, and backend testing.
- [Face verification](verification/FACE_VERIFICATION.md): server trust boundary,
  Render contract, and verification status.
- [Native face challenge](verification/NATIVE_FACE_CHALLENGE.md): native detector
  behavior and challenge-state validation.
- [Mobile face testing](mobile/MOBILE_FACE_TESTING.md): development-build and
  physical-device test instructions.

The root `functions/` folder is an inactive legacy Firebase Functions implementation.
Its own README explains why it remains in place and how it differs from the active
Vercel API under `api/`.
