---
name: bluetap-routing-stability
description: Preserve verified BlueTap Expo Router destinations, role layouts, authenticated refresh behavior, and overlay-only global utilities when changing navigation or route actions.
---

# BlueTap Routing Stability

Use these rules for every BlueTap route, navigation action, authenticated refresh, or global overlay change:

1. Never invent Expo Router paths.
2. Inspect the `app/` filesystem before changing any route target.
3. Verify that each destination exists and mounts correctly on web and native.
4. Prefer overlay or local state opening for global floating utilities such as Chat.
5. Do not call `router.push` from `ChatFloatingLauncher` unless a real route is intentionally defined.
6. Keep navigation inside the authenticated role tree: Requester to `requester`, Distributor to `distributor`, Manager to `manager`, and Admin to `admin`.
7. Validate required dynamic-route parameters before navigation.
8. Browser refresh on an authenticated nested route must wait for auth, profile, and branch hydration and must not blank the app.
9. Never replace a working route merely to make a button URL look cleaner.
10. Before committing a routing change, search every old and new path reference, Babel-parse changed JavaScript/JSX, run `npm test`, run `npm run build`, and verify the web export recognizes the route.
11. If a destination is uncertain, stop and inspect the actual route structure rather than guessing.
12. Keep global modal and overlay features mounted at the role-layout level; do not navigate to fake pages.
13. Add route regression tests for critical actions and verify both the emitted route string and its destination file.
14. Route-triggering buttons and icons must use shared single-flight navigation. Repeated presses to the same destination while navigation is pending are ignored, and pressing the current route is a no-op.
15. Preserve history semantics: use `push` only when the previous screen should remain in history and retain established `replace` behavior for role tabs and redirects. Never solve duplicate history by globally converting pushes to replaces.
16. Animated in-app Back controls must be single-flight so their exit animation can call `router.back()` at most once. Do not intercept or alter browser and hardware Back behavior for this purpose.
17. Prefer the shared navigation helper over component-specific timeout flags. Locks must release when the destination settles, include a bounded fallback, and clean up on unmount.

## Verified Distributor destinations

- Home: `/distributor/d_dashboard`
- Requests and Review Assignment: `/distributor/d_requests`
- Schedule: `/distributor/d_scheduled_requests`
- Profile: `/distributor/d_profile`

The floating messenger and “Message your station” open the role-level chat panel. They are not routes.

## Verified order-detail destinations

- Requester order context: `/requester/r_notification?orderId=<authorized-order-id>`
- Distributor order context: `/distributor/d_notification?orderId=<authorized-order-id>`
- Manager order context: `/manager/request?orderId=<branch-authorized-order-id>`

These routes resolve the ID against the current role-scoped live collection before opening details. Order-linked chat cards and notifications may use them; generic chat launchers and station resolution remain overlays.

- Manager approval notifications navigate to `/manager/request` with the canonical order ID.
- Suspended or terminated account transitions replace protected content with the dedicated account-state screen, clear sessions, and return to the correct shared sign-in route without leaking moderation details.
