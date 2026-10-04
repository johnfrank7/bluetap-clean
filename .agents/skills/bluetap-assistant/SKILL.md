---
name: bluetap-assistant
description: Operational assistant, safe context, multilingual intent, and assistant UI
---

# BlueTap Assistant

The BlueTap Assistant (`app/requester/bluetap_AI.jsx`) is a specialized operational assistant for authenticated BlueTap Requesters. It provides contextual answers and deterministic routing for water request fulfillment, delivery schedules, station coverage, moderation notices, and account guidance.
The BlueTap Assistant is a specialized operational assistant for authenticated BlueTap Requesters (`/requester/bluetap_AI`) and Distributors (`/distributor/bluetap_AI`). It provides contextual answers and deterministic routing for water request fulfillment, delivery schedules, station coverage, assigned queues, delivery details, moderation notices, and account guidance.

## Core Invariants

1. **Requester Portal Shell Integration**:
   - The Assistant screen is rendered inside `UserPortalShell` (`app/requester/_layout.jsx`), which supplies `RequesterHeader` and the floating `RequesterBottomNav`.
   - The screen layout must strictly adhere to `USER_PORTAL_LAYOUT.maxWidth` (480px) and `phoneWrapper` centering.
   - Do not render duplicate outer headers (BlueTap wordmark, logo, or global theme toggle) or duplicate bottom navigation bars.
   - The Assistant input composer must sit directly above the floating navigation bar by reserving `USER_PORTAL_BOTTOM_CONTENT_INSET` at the bottom of its container.
1. **Shared Assistant Core Architecture**:
   - Both roles share `components/assistant/AssistantScreen.jsx`, which encapsulates the sub-header card (with `✕` back and `↺` new conversation buttons), message feed, quick action chips, message composer, and same-day AsyncStorage persistence.
   - Screen layout strictly adheres to `USER_PORTAL_LAYOUT.maxWidth` (480px) and `phoneWrapper` centering inside `UserPortalShell`.
   - The Assistant input composer sits directly above the floating bottom navigation bar by reserving `USER_PORTAL_LAYOUT.navHeight + USER_PORTAL_LAYOUT.navBottomOffset + (isMobile ? 12 : 14) + (insets.bottom || 0) - 6`.

2. **Authorized Context and Privacy Boundaries**:
   - Context is built strictly via `buildSafeAssistantContext` (`services/assistant/assistantContext.js`).
   - Only sanitized and authorized requester data is consumed (`profile`, `orders`, `moderationNotices`, `roleNotifications`, `branches`).
   - Never expose internal database identifiers, server IPs, tokens, passwords, secrets, dispatcher IDs, reporter UIDs, or private moderator notes.
   - Order IDs must use public display IDs (`ORD-XXXX` or `BT-XXXX`) instead of raw Firestore UIDs.
   - Delivery failure reasons are sanitized via `formatDeliveryFailureReason`.
2. **Role-Scoped Authorized Context & Privacy Boundaries**:
   - Requesters use `buildSafeAssistantContext` (`services/assistant/assistantContext.js`).
   - Distributors use `buildSafeDistributorContext` (`services/assistant/assistantContext.js`).
   - Context is built strictly from sanitized role data:
     - Requesters: profile, orders, catalog products, moderation notices, notifications.
     - Distributors: profile, assigned orders, branch info, moderation notices, notifications.
   - **Privacy Boundary**: Never expose internal database identifiers, server secrets, dispatcher IDs, reporter UIDs, private moderator notes, or **raw GPS coordinates** (`latitude`, `longitude`, `coords`). Locations are strictly converted to safe address labels (`formatSafeAddressLabel`).
   - Order IDs must use public display IDs (`BT-XXXX`) instead of raw Firestore UIDs.

3. **Multilingual and Intent Handling**:
   - Classifies customer queries deterministically using `classifyIntent` (`services/assistant/assistantIntents.js`).
3. **Authoritative Delivery Chat Authority**:
   - Chat permissions for distributors (`requester_distributor`) strictly follow order lifecycle rules evaluated in `evaluateDistributorOrderChatAuthority`:
     - **Active Delivery** (`scheduled`, `out_for_delivery`, `accepted`): Chat allowed.
     - **Delivered**: Order completed, chat closed immediately.
     - **Failed Delivery**: 1-hour grace window from failure timestamp (`FAILED_DELIVERY_CHAT_GRACE_MS = 3600000`). Within grace, chat is permitted; once expired, chat is closed.
     - **Cancelled / Reassigned**: Closed / denied to previous distributor.

4. **Role-Scoped Storage Isolation**:
   - Stored in AsyncStorage under `bluetap-assistant:${role}:${userId}`.
   - Automatically migrates legacy un-scoped `bluetap-assistant:${userId}` keys.
   - Separate accounts and roles do not cross-talk or overwrite each other's transcripts.
   - Old transcripts from previous dates are pruned on new-date initialization.

5. **Multilingual and Intent Handling**:
   - Deterministic classification: `classifyIntent(text, role)` routes to `classifyDistributorIntent` or `classifyIntentDetails`.
   - Detects English and Cebuano/Bisaya query phrasing using `detectLanguage` and Cebuano markers.
   - Responses must adapt to the detected language while preserving BlueTap operational terminology.
   - Quick-action chips supply explicit canonical intent constants that bypass natural language re-classification.

4. **Deterministic Safe Actions**:
   - Actions are dispatched via `executeAssistantAction` (`services/assistant/assistantActions.js`).
   - Allowed action types:
     - `START_ORDER`: Routes to `/requester/requestform`.
     - `VIEW_ORDER`: Routes to `/requester/r_notification` with `orderId` parameter or `/requester/r_request`.
     - `OPEN_REQUESTS`: Routes to `/requester/r_request`.
     - `CONTACT_STATION`: Dispatches station chat using `chat.resolveAndOpen({ type: 'requester_branch', branchId, intent: 'inquiry' })` or `chat.openStationChat`.
     - `OPEN_NOTIFICATIONS`: Routes to `/requester/r_notification`.
     - `VIEW_PROFILE`: Routes to `/requester/r_profile`.
   - Unknown or malicious actions must be strictly rejected.
6. **Deterministic Safe Actions (Read / Explain / Navigate Only)**:
   - High-impact delivery mutations (e.g. mark delivered, fail delivery, accept/decline) are NEVER executed directly through Assistant conversation.
   - Allowed Action Types:
     - Requester: `START_ORDER` (`/requester/requestform`), `VIEW_ORDER`, `OPEN_REQUESTS`, `CONTACT_STATION` (`requester_branch`), `OPEN_NOTIFICATIONS`, `MANAGE_DELIVERY_LOCATION`, `VIEW_PROFILE`.
     - Distributor: `VIEW_DELIVERY` (`/distributor/d_scheduled_requests`), `OPEN_SCHEDULE` (`/distributor/d_scheduled_requests`), `OPEN_HISTORY` (`/distributor/d_history`), `OPEN_REQUESTS` (`/distributor/d_requests`), `CONTACT_REQUESTER` (`requester_distributor`), `CONTACT_STATION` (`distributor_branch`), `OPEN_NOTIFICATIONS` (`/distributor/d_notification`).

5. **Component Architecture**:
   - `components/assistant/AssistantCards.jsx`: Structured cards for orders, stations, restrictions, notifications, and instructions.
   - `components/assistant/AssistantQuickActions.jsx`: Context-aware horizontal quick query chips.
7. **Component Hierarchy**:
   - `components/assistant/AssistantScreen.jsx`: Shared UI & orchestration shell.
   - `components/assistant/AssistantCards.jsx`: Structured cards for orders (`OrderCard`), distributor deliveries (`DeliveryCard`), stations, restrictions, and notifications.
   - `components/assistant/AssistantQuickActions.jsx`: Context-aware horizontal quick query chips for both Requester and Distributor.
   - `components/assistant/AssistantComposer.jsx`: Accessible message composer with web Enter support and clear button.
   - `components/assistant/AssistantMessageBubble.jsx`: Themed message bubbles for user and assistant with droplet branding.
