---
name: bluetap-user-portal-ui
description: Build or refactor BlueTap Requester and Distributor portal shells, headers, responsive content sizing, floating navigation, safe-area spacing, and map/card containment. Do not use for Admin or Manager dashboard structure.
---

# BlueTap User Portal UI

The Distributor portal layout dimensions are the default BlueTap user portal dimensions.

Requester and Distributor share one responsive portal shell. Keep role-specific content and behavior separate, but derive structural dimensions from shared tokens rather than duplicating hardcoded values.

Preserve these invariants:

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
- All user-portal theme colors come from shared semantic tokens, including backgrounds, headers, cards, inputs, tabs, buttons, text, borders, and navigation.

## Deferred messaging scope

- Chat, conversations, unread or read state, typing indicators, and cross-role messaging are explicitly deferred. Only disabled, clearly labelled “coming soon” affordances may reference future messaging.
