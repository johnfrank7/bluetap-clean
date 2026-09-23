---
name: bluetap-backend-deployment
description: Review and plan BlueTap deployments across Vercel, Render Node, Render Python, Firebase, and Expo. Use when determining deploy targets, environment-secret boundaries, Firebase rules deployment, or whether runtime Admin data changes require a rebuild.
---

# BlueTap Backend Deployment

Use this ownership map before changing configuration or recommending a deployment:

- Vercel hosts the frontend and the internal Gmail relay.
- Render Node owns authoritative authentication, registration, ordering, and Admin business APIs.
- Render Python owns face verification.
- Firebase owns Authentication and Firestore.
- Supabase Storage owns BlueTap product image files only.

## Secret boundaries

- Never prefix server secrets with `EXPO_PUBLIC_`; that prefix exposes values to the client bundle.
- Keep `SUPABASE_SERVICE_ROLE_KEY` on Render Node only. Product-image uploads must go through the authenticated Render API; never expose that key to frontend code.
- Never commit service-account JSON, `.env` files, Gmail App Passwords, relay secrets, Firebase Admin private keys, or API keys.
- Keep frontend-safe public configuration distinct from privileged backend credentials.

## Deployment rules

- Deploy Firestore rule changes separately with Firebase CLI; application-host redeploys do not publish Firebase rules. Product images do not require Firebase Storage rules.
- Redeploy the affected Render service after backend changes: Node for auth, registration, ordering, or Admin APIs; Python for face verification.
- Redeploy Vercel after frontend or internal Gmail relay changes.
- Rebuild the Expo native app after native dependency changes or `app.json` permission/plugin changes.
- Treat Admin product and branch edits as runtime data. They must not require a frontend redeploy.

## Readiness checklist

1. Identify changed files and map each one to its owning platform.
2. Verify all server-authoritative validation remains on Render Node and cannot be overridden by client fields.
3. Check that required environment variables are configured only on their owning host and are absent from Git.
4. Run the repository tests and production build.
5. Deploy Firebase rules first when backend behavior depends on them, then backend services, Vercel, and finally any required Expo native build.
