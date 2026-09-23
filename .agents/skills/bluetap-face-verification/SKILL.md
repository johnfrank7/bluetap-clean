---
name: bluetap-face-verification
description: Preserve BlueTap face verification, warmup, and enrollment architecture when changing face capture, signup, Node verification APIs, or Python face-service integration.
---

# BlueTap Face Verification

- Use OpenCV SFace + YuNet only.
- Keep the path client → Render Node backend → protected Python face API. Clients never call the Python service directly; `DEEPFACE_API_KEY` is server-only.
- A signup click starts non-blocking Node-mediated warmup. Reuse one shared in-flight warmup.
- Poll readiness every 4 seconds for at most 75 seconds. Stop when ready, abandoned, or disabled; never leave an infinite “Preparing face verification” state.
- Cold starts must not consume verification attempts.
- Temporary registration-face data is not permanent enrollment. Enroll permanently only after successful registration finalization; abandoned registrations cannot become permanent duplicates.
- Respect the Admin face-verification toggle.
- Never log face images, embeddings, or credentials.
