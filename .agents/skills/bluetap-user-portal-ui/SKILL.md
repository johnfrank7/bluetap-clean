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
   - **Light Theme Standards**: Light theme must reflect BlueTap's blue brand identity with clean light backgrounds, crisp card separation, readable high-contrast typography, and semantic status accents. Distributor light mode must use the same current BlueTap palette/shell family as Requester and may not regress to legacy generic white page surfaces.
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
- All user-portal theme colors come from shared semantic tokens, including backgrounds, headers, cards, inputs, tabs, buttons, text, borders, and navigation. Never use hardcoded colors such as `#F4FAFF` or `#FFFFFF` in distributor screens (`d_dashboard.jsx`, `d_history.jsx`, `d_notification.jsx`, `d_profile.jsx`, `d_requests.jsx`, `d_scheduled_requests.jsx`); use `BLUETAP_COLORS.background`, `BLUETAP_COLORS.surface`, and shared theme tokens.

## Visual Hierarchy and Light/Dark Theme Discipline

1. **Canonical Layered Hierarchy**:
   - **Blue Brand / Header**: BlueTap Blue (`BLUETAP_COLORS.primary` / `#187BCD`).
   - **Page Background**: Soft blue-tinted background (`BLUETAP_COLORS.background` / `#F4FAFF` in light mode, deep blue-black navy in dark mode).
   - **Card Surfaces**: Crisp white/light surface (`BLUETAP_COLORS.surface` / `#FFFFFF` in light mode, elevated navy surface in dark mode) paired with pale-blue borders (`BLUETAP_COLORS.border` / `#D7ECFF`) and soft blue shadows (`#0D47A1`, elevation 6, opacity 0.12).
   - **Primary Text**: Dark Navy (`BLUETAP_COLORS.textPrimary` / `TEXT_DARK` / `#12304A`) for page titles, section headers, important metrics, card headers, and primary data values. Avoid all-blue text washes.
   - **Secondary Text**: Slate (`BLUETAP_COLORS.textSecondary` / `TEXT_MUTED` / `#64748B`) for metadata labels, helper text, subtitles, and descriptions.
   - **Interactive Actions**: BlueTap Blue (`BLUETAP_COLORS.primary` / `BLUE` / `#187BCD`) reserved for primary action buttons, active tab pills, and key interactive accents.
2. **Contrast and Dark Mode Discipline**:
   - Text contrast must be maintained across both light and dark themes. Titles and values must use `TEXT_DARK` (`BLUETAP_COLORS.textPrimary`), which inverts to bright readable off-white (`#F5FAFF`) in dark mode, and `TEXT_MUTED` (`BLUETAP_COLORS.textSecondary`), which inverts to readable slate (`#9FB4C8`).
   - Never hardcode `#187BCD` or other blue shades directly onto text styles that should be primary or secondary content, as this degrades readability on dark navy card backgrounds.
3. **Pinned Header Area Bleed Prevention**:
   - Any fixed or pinned header container (e.g. `fixedHeaderArea`) positioned above a `ScrollView` must declare `backgroundColor: BLUETAP_COLORS.background` and `zIndex: 10`. This prevents scrolled list cards from visibly bleeding or showing through beneath the header controls during scrolling.
4. **SoftStatusBadge Semantic & Dark-Mode Mapping**:
   - `SoftStatusBadge` must cover all order lifecycle statuses, including `'delivery failed'` and `'delivery failed rescheduling'`, with semantic danger styling (`#FEF2F2` / `#EF4444`).
   - Badges must provide explicit dark-mode mappings (`DARK_STATUS_META` or theme-aware colors) to ensure high-contrast text and border rendering against dark navy card surfaces.

## Notifications and order events

- Distributor notifications (`app/distributor/d_notification.jsx`) reuse the card visual system from `app/requester/r_notification.jsx`: clean structured notification cards, delivery date/status badges, real order lifecycle events, empty state handling, and theme token adherence.
- Notifications derive directly from authenticated order states and branch dispatch events; do not use mock notifications or disconnected static lists.

## Navigation gestures, carousels, and empty states

- Primary tab navigation in Requester and Distributor portals supports swipe navigation via `PortalSwipeContainer`. Swiping is guarded against accidental vertical scroll triggers (`|dx| > 50` and `|dx| > 2.2 * |dy|`).
- Nested horizontal swipe widgets (e.g. `Carousel` and pagination indicators) must be wrapped in `<PortalSwipeIgnore>` from `components/PortalSwipeContainer.jsx` to suppress portal tab navigation while interacting with carousel items.
- Breaking circular dependencies: `UserPortalFrame` is isolated in `components/UserPortalFrame.jsx` so that `BlueTapHeader` and `UserPortalShell` do not import each other cyclically, avoiding runtime TDZ initialization crashes (`ReferenceError: Cannot access 'X' before initialization`).
- Real-time greetings: Dashboards use `useLiveGreeting` from `services/liveTime.js` to update local time-of-day greetings ("Good Morning", "Good Afternoon", "Good Evening") dynamically without triggering full page reloads or relying on third-party APIs.
- Empty lists and query results must render `BlueTapEmptyState` with the shared sad water droplet motif, informative headline, contextual explanation, and call-to-action button where appropriate.
- Headers, view tabs, and primary action controls (e.g. "Add Request" or scheduled delivery tabs) must remain pinned in a fixed container above the `ScrollView` so filters and actions remain instantly operable during scrolling. The pinned header area must use an opaque background surface (`colors.background` in dark mode, `colors.primary` or `colors.surface` in light mode) and proper vertical spacing so scrollable order cards never visibly clip or show through beneath the header controls.
- Tab toggles (such as Active Orders / History in `r_request.jsx` and delivery tabs in `d_scheduled_requests.jsx`) must provide distinct active, hover, and pressed visual states via `Pressable` for consistent web and touch feedback.
- When a primary action button (such as "Add Request") is already pinned in the fixed header area, do not duplicate it inside the empty state view below.
- User portal feedback across forms and actions uses `TopToastFeedback` for theme-aware, top-anchored, auto-dismissing feedback messages (`success`, `error`, `warning`, `info`).
- Public user identifiers must display formatted public UIDs (`Req001`, `Dis001`, `Mgr001`, `Adm001`) with label "UID" positioned at the top of profile fields above Full Name. Contact numbers must validate and normalize Philippine mobile numbers (`+639XXXXXXXXX`, formatted for display as `09XX XXX XXXX`).

## Deferred messaging scope

- Chat, conversations, unread or read state, typing indicators, and cross-role messaging are explicitly deferred. Only disabled, clearly labelled “coming soon” affordances may reference future messaging.
