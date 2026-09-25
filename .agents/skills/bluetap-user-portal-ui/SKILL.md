---
name: bluetap-user-portal-ui
description: Build or refactor BlueTap Requester and Distributor portal shells, headers, responsive content sizing, floating navigation, safe-area spacing, and map/card containment. Do not use for Admin or Manager dashboard structure.
---

# BlueTap User Portal UI

The Distributor portal layout dimensions are the default BlueTap user portal dimensions.

Requester and Distributor share one responsive portal shell. Keep role-specific content and behavior separate, but derive structural dimensions from shared tokens rather than duplicating hardcoded values.

Preserve these invariants:

## Requester / Distributor Portal Shell Invariants

1. **Requester is the Reference Layout**: The Requester portal shell is the visual and structural layout reference for Distributor. Distributor screens must match the polish, header hierarchy, and styling conventions of Requester.
2. **Every Full Requester / Distributor Portal Screen Must Have the Portal Shell**:
   - **Header Shell**: Every primary portal screen (including notifications) must render the standard portal header with BlueTap logo icon, bold "BlueTap" wordmark, compact theme toggle (moon/sun), and contextual header actions (such as notifications or back button).
   - **Floating Bottom Navigation**: Detached rounded pill navigation bar must be present on primary screens. Its outer positioning wrapper is strictly transparent, pointer-safe, and visually unpainted.
   - **Light Theme Standards**: Light theme must reflect BlueTap's blue brand identity with clean light backgrounds, crisp card separation, readable high-contrast typography, and semantic status accents.
   - **Dark Theme Standards**: Dark theme uses layered deep navy and blue-black surfaces, never pure black as the main background, strictly adhering to shared theme tokens.
   - **Swipe Navigation**: Primary portal tabs must support horizontal swipe transitions via `PortalSwipeContainer` (with vertical scroll suppression and navigation debouncing), wrapping every main tab including Profile.
   - **Notifications System**: Both Requester and Distributor notifications must reuse the shared structured notification card system, derived from real order lifecycle events with robust multi-format timestamp parsing.


- Header, page content, and floating navigation use the same centered max-width and mobile gutters.
- The floating bottom navigation remains a detached rounded pill. Its outer positioning wrapper is transparent, pointer-safe, and visually unpainted.
- Scroll pages reserve bottom content space for nav height, bottom offset, safe-area inset, and a small visual margin.
- No page uses an arbitrary fixed width that exceeds the shared portal shell.
- Maps, images, and cards use `width: '100%'`, `maxWidth: '100%'`, and `minWidth: 0` where flex sizing can overflow.
- Web maps recalculate their viewport when their parent width changes; preserve interactions, rounded clipping, controls, and required attribution.
- User portal pages never introduce horizontal scrolling at supported mobile, tablet, or desktop widths.
- Mobile safe-area and keyboard behavior are mandatory, especially for forms and final actions.
- Light and dark surfaces apply only to the visible nav pill; the overlay behind it stays transparent.
- Role-specific functionality may differ, but structural dimensions should not.

## Shared user-portal theme

- Requester and Distributor share the same global BlueTap theme state and persisted preference.
- The default user-portal theme is BlueTap light/blue.
- The landing page is the source of truth for dark-theme colors and the compact moon/sun toggle pattern.
- Place the shared theme control beside notifications in the shared user-portal header.
- Distributor remains the structural sizing source of truth; changing theme must not change portal dimensions.
- The floating navigation outer wrapper is always transparent and visually unpainted.
- Light-mode floating navigation uses the shared light surface with BlueTap blue icons.
- Dark-mode floating navigation uses the landing-page dark elevated surface with theme-aware icons and border.
- Never create role-specific hardcoded palettes for Requester or Distributor.
- All user-portal theme colors come from shared semantic tokens, including backgrounds, headers, cards, inputs, tabs, buttons, text, borders, and navigation. Never use hardcoded colors such as `#F4FAFF` or `#FFFFFF` in distributor screens (`d_dashboard.jsx`, `d_history.jsx`, `d_notification.jsx`, `d_profile.jsx`, `d_requests.jsx`, `d_scheduled_requests.jsx`); use `BLUETAP_COLORS.background`, `BLUETAP_COLORS.surface`, and shared theme tokens.

## Notifications and order events

- Distributor notifications (`app/distributor/d_notification.jsx`) reuse the card visual system from `app/requester/r_notification.jsx`: clean structured notification cards, delivery date/status badges, real order lifecycle events, empty state handling, and theme token adherence.
- Notifications derive directly from authenticated order states and branch dispatch events; do not use mock notifications or disconnected static lists.

## Navigation gestures and empty states

- Primary tab navigation in Requester and Distributor portals supports swipe navigation via `PortalSwipeContainer`. Swiping is guarded against accidental vertical scroll triggers (`|dx| > 50` and `|dx| > 2.2 * |dy|`).
- Empty lists and query results must render `BlueTapEmptyState` with the shared sad water droplet motif, informative headline, contextual explanation, and call-to-action button where appropriate.
- Headers, view tabs, and primary action controls (e.g. "Add Request" or scheduled delivery tabs) must remain pinned in a fixed container above the `ScrollView` so filters and actions remain instantly operable during scrolling. The pinned header area must use an opaque background surface (`colors.background` in dark mode, `colors.primary` or `colors.surface` in light mode) and proper vertical spacing so scrollable order cards never visibly clip or show through beneath the header controls.
- Tab toggles (such as Active Orders / History in `r_request.jsx` and delivery tabs in `d_scheduled_requests.jsx`) must provide distinct active, hover, and pressed visual states via `Pressable` for consistent web and touch feedback.
- When a primary action button (such as "Add Request") is already pinned in the fixed header area, do not duplicate it inside the empty state view below.
- User portal feedback across forms and actions uses `TopToastFeedback` for theme-aware, top-anchored, auto-dismissing feedback messages (`success`, `error`, `warning`, `info`).
- Public user identifiers must display formatted public UIDs (`Req001`, `Dis001`, `Mgr001`, `Adm001`) with label "UID" positioned at the top of profile fields above Full Name. Contact numbers must validate and normalize Philippine mobile numbers (`+639XXXXXXXXX`, formatted for display as `09XX XXX XXXX`).

## Deferred messaging scope

- Chat, conversations, unread or read state, typing indicators, and cross-role messaging are explicitly deferred. Only disabled, clearly labelled “coming soon” affordances may reference future messaging.
