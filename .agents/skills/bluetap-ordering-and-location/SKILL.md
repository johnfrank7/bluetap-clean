---
name: bluetap-ordering-and-location
description: Build or review BlueTap Requester ordering, Admin branch/product management, order pricing snapshots, and on-demand web/native location or map flows.
---

# BlueTap Ordering and Location

Use this skill for BlueTap product catalogs, provider selection, order creation, branch coordinates, delivery maps, and Requester order experiences.

## Inspect and reuse first

- Inspect the current Requester dashboard, Orders, New Request, notifications, profile, shared header, bottom navigation, services, backend routes, Firestore rules, branch model, and product model before changing code.
- Reuse shared BlueTap UI tokens, shells, authentication/session helpers, service caches, and existing schemas. Refactor working components instead of creating parallel screens or duplicate data models.
- Preserve authentication, role gates, forced-password behavior, registration, OTP, face verification, Admin, Manager, and Distributor behavior.

## Authority and synchronization

- Admin is the authoritative source for branches, products, prices, active state, coordinates, and optional branch availability. Product metadata and pricing remain Firestore/Render-backend authoritative.
- Never hardcode branch or product lists in Requester production UI.
- Expose shared cached queries for active branches, active products, branch products, and Requester orders. Deduplicate concurrent reads and keep cache lifetimes short.
- Invalidate relevant branch/product caches after Admin mutations. Requesters must see changes after refresh/revalidation without an app or web redeploy.
- Product management is Admin-only and audited. Archive or deactivate referenced products; do not permanently delete historical dependencies.

## Secure ordering

- Treat the authenticated UID as the only authoritative Requester identity. Ignore any target UID submitted by a client.
- Clients submit identifiers, quantities, selected options, and delivery coordinates—not trusted prices or totals.
- The backend must re-read the product and branch, require both to be active, validate branch availability and the Requester profile, and calculate all monetary values from authoritative prices.
- Store `branchId`, `productId`, `productNameSnapshot`, `branchNameSnapshot`, `unitPriceAtOrder`, quantity, `totalAtOrder`, delivery-location snapshot, distance snapshot, status, and timestamps.
- Store `initialBranchId` and `currentBranchId` for fulfillment ownership. The initial selection remains historical context; the current Branch alone controls operational assignment and handoff actions.
- Historical orders must not change when product price, product metadata, or branch metadata changes.
- Restrict order/location reads to the Requester owner and only the fulfillment roles assigned to that order or branch.

## Dispatch and branch transfers

- After a Manager approves an outside-radius order, keep it owned by the selected Branch in `awaiting_distributor_assignment`; do not auto-assign a Distributor.
- Resolve Distributor eligibility server-side from the trusted account record. Assignment and reassignment require an active/approved, enabled Distributor in the current owning Branch. Never trust client-provided names, role, approval, or branch fields.
- Treat `users/{uid}.branchId` as the sole operational Distributor branch. An active Distributor without it is an assignment-required legacy account, not eligible for dispatch; do not infer a branch from current deliveries or historical orders.
- Distributor branch reassignment is an Admin backend workflow. Validate the target branch is active, block reassignment while the Distributor has active deliveries, preserve completed/assignment history, and audit old branch, new branch, actor, and timestamp.
- A Manager may initiate a transfer only from the current owning Branch and only to a different active Branch with an active Manager. A transfer is pending review until the target Branch Manager accepts or declines it.
- Do not change `currentBranchId` or `branchId` when a transfer is proposed. Change both only after target acceptance; a decline returns the source-owned order to assignment without deleting historical transfer data.
- Preserve append-only assignment, transfer, and dispatch event histories with server timestamps and actor IDs. Derive Manager and Distributor notifications/queues from those server-scoped order states; do not create a general delivery chat or expose unrelated orders.
- Persist each accepted or declined branch-transfer outcome as a server-written, deduplicated Manager operational event scoped to the source Branch. Source Managers retrieve it through an authorized backend endpoint; target and unrelated Branch Managers cannot enumerate it.
- Return exact delivery coordinates only to the current owning Branch Manager and the assigned active Distributor. Distributor order endpoints must filter by both the authenticated UID and current Branch ownership.

## Location and maps

- Toledo City is BlueTap's current Branch address scope. Branch Barangay is a controlled, searchable selection sourced from the approved Toledo City barangay list; City defaults to `Toledo City` and should not be repeatedly entered by Admin.
- Branch location may be captured through an explicit one-shot GPS action or a manual interactive map pin. Latitude and longitude are implementation details and read-only metadata in the normal Admin form, not primary free-text inputs.
- Branch service radius defines normal delivery coverage. Never infer it automatically from GPS; render its visible radius circle around the Branch map pin and update it immediately when Admin changes the radius.
- Compare Haversine distance to the selected Branch's service radius on the backend. Outside-radius orders require Manager approval rather than automatic rejection; the backend is authoritative for branch, distance, radius, and eligibility decisions.
- Historical orders store trusted distance and service-radius snapshots. Later Branch radius edits affect new orders only and never rewrite submitted-order history.
- Request location only after an explicit ordering action such as “Use my current location.” Never continuously track users.
- On web, use browser geolocation behind a shared abstraction. On native Expo, request foreground permission only and use a compatible native location API.
- If permission is denied or unavailable, explain why location is needed, provide retry guidance, and retain manual map-pin selection when practical. Do not repeatedly prompt automatically.
- Provider candidates are active Admin-created branches with valid latitude and longitude.
- Rank candidates nearest to farthest using Haversine distance unless a configured routing provider supplies road distance.
- Label Haversine values as approximate or straight-line distance. Never present them as driving distance.
- Store the selected provider by `branchId`, not only by display name.
- Shared maps must support web and native appropriately, show delivery and provider markers, highlight selection, and provide a fit-view action.
- The New Request map must fit its container responsively without horizontal overflow. Selecting a GPS location or a manual map pin immediately unlocks active-branch ranking and refreshes the provider list; manual selection remains available when permission is denied.
- Treat exact delivery coordinates as sensitive fulfillment data: do not add them to analytics, general logs, or unrelated profiles.

## Product and Requester UI

- Product images may be stored in Supabase Storage, while their URL/path metadata remains in Firestore. ProductCard consumes the supplied `imageUrl` and remains storage-provider agnostic.
- Product images use a consistent, prominent image surface with contain-based sizing; never distort or crop packaging. Show a professional placeholder when missing.
- Use one reusable ProductCard across Requester discovery and ordering where practical.
- Keep Requester layouts mobile-first and responsive on tablet/web, with clear cards, loading states, empty states, and retry states.
- The bottom navigation must participate in safe layout flow or reserve equivalent safe-area space; it must never cover form fields, review controls, or submit buttons.
- New Request should be visibly structured: delivery location, provider, products, details, review, submit.
- Block submission and provide an Edit/Complete Profile action when required profile data is missing.
- Notifications must derive from real order state; do not ship demo order messages.
- Requester Active Orders and the Dashboard Current Request must share one status classifier: every non-terminal lifecycle state remains active, while delivered, cancelled, declined, and rejected equivalents belong only in History.
- Requester order reads must be scoped to the authenticated Firebase UID through the authoritative ordering endpoint. After a successful server-created order, prime or invalidate the per-UID order cache so the new order appears without a logout or stale-empty-state delay.

## Verification

- Test location grant, denial, unavailable and manual selection; Haversine ordering; inactive/unlocated branch exclusion; markers, selection and fit view; missing images; multiple products; Admin product and branch lifecycle; price recalculation and snapshots; inactive product/branch rejection; trusted UID; exact order snapshots; bottom-nav/keyboard safety; notifications; profile fallbacks; and supported theme behavior.
- Run the full repository test suite and production build. Report Firestore/Storage rule changes, backend and frontend deployment needs, native rebuild needs, and the exact skill file updated.
