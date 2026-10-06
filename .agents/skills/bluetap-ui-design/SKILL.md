---
name: bluetap-ui-design
description: Design or refactor BlueTap landing, Admin, or Manager interfaces while preserving the product's shared visual system and existing application behavior.
---

# BlueTap UI Design

Use the existing landing page as the primary branding reference. Inspect current styles and `constants/bluetapTheme.js` before choosing colors; do not introduce arbitrary blue variants.

Admin and Manager screens belong to one dashboard design system. Reuse the shared theme and dashboard components for page shells, navigation, cards, forms, buttons, status badges, loading states, notices, and empty states. Prefer extending shared components over copying styles into individual routes.

Admin navigation uses a shared collapsible sidebar: keep desktop transitions subtle and fast, use an off-canvas drawer with a backdrop on small screens, and preserve icons plus accessible labels when collapsed. Admin theme preferences support Light, Dark, and System through shared global tokens; BlueTap primary remains the source of truth. Both AdminShell and ManagerShell feature a topbar compact theme toggle (beside role badges) for quick switching. Confirm logout in the shared shells via accessible confirmation modals supporting the Escape key; clear only auth/session state on confirmation, and allow harmless UI preferences such as theme and sidebar state to persist. Remove non-functional dead search inputs from dashboard shells.

Admin Requests oversight (`/admin/requests`) provides a platform-wide read-only view of customer orders and fulfillment statuses across all branches. The Admin sidebar displays a live actionable count badge (`Requests [N]`) subscribing to orders pending review (`pending`, `outside_radius_pending_approval`, `branch_transfer_pending`). Admin oversight remains strictly read-only; operational branch dispatch, assignments, and situational edits belong exclusively to Branch Managers, except for emergency Admin Distributor Override (`AdminOverrideModal`) strictly constrained to same-branch distributors with required audit reason logging. Manager navigation (`ManagerShell`) similarly displays an active badge on the Requests link, subscribing in real time to branch-scoped unfulfilled orders and incoming transfer requests.

Admin override actions must expose only one clear entry point per order-details context, and emergency override dialogs must use structured callouts, grouped context, and visible primary/secondary actions in both light and dark mode.

Operational oversight lists should use clear filter states, compact sort and search controls, contextual empty states, bounded pagination, and readable semantic statuses without expanding role permissions.

Administrative entity-management pages should use semantic status summaries, contextual empty states, compact search/filter/sort controls, bounded pagination, and responsive tables/cards without duplicating authoritative workflows.

ProductCard discovery and ordering components adhere to shared theme tokens: high-contrast action buttons (`BLUETAP_COLORS.primary` with white text), surface styling, and contain-based image presentation that preserves packaging aspect ratios across light and dark modes. Pinned dashboard and portal headers must maintain opaque backgrounds to prevent scrollable content bleed-through. Toast notifications use `TopToastFeedback` for theme-aware, top-anchored alerts.

BlueTap dark mode uses layered deep navy and blue-black surfaces, never pure black as the main background. Keep BlueTap blue as the primary accent; Admin and Manager share one dark palette through theme tokens, while the landing page remains the branding reference. Build premium card separation with subtle borders and restrained highlights. Do not introduce random hardcoded dark colors in screens: use the shared background, sidebar, surface, surfaceAlt, border, primary, text, muted, and semantic tokens.

Every user-visible state must be verified in both BlueTap light and dark themes, including normal, hover, focus, pressed, selected, disabled, loading, modal, toast, badge, table, and empty-state variants. Theme-dependent text and surfaces must use semantic tokens rather than fixed light-only or dark-only colors, and filled semantic actions must use the matching `onPrimary`, `onSuccess`, `onWarning`, or `onDanger` foreground.

Preserve these invariants:

- Use shared tokens for the primary blue, surfaces, borders, text, semantic colors, spacing, radii, and shadows.
- Keep destructive actions red and success states green.
- Admin warning callouts and primary actions must remain visibly contrasted in both light and dark themes. Use semantic warning surfaces and explicit high-contrast primary button text.
- Pair active-state color with another visual cue such as a border, marker, weight, or icon.
- Keep forms labelled, keyboard accessible on web, visibly focused, and usable at touch sizes.
- At tablet and mobile widths, collapse or reflow navigation, stack cards and form fields, and keep tables horizontally scrollable.
- Do not change authentication, authorization, role checks, branch scoping, backend APIs, OTP, face verification, or other business logic during a visual refactor unless minimal UI wiring requires it.

Before finishing, compare the landing page, Admin shell, and Manager shell for color, typography, radius, card, button, spacing, and responsive consistency. Run the web build and relevant tests.

Accounts & Audit uses one unified account table for Requesters, Distributors, and Managers, with responsive search, filters, actions, and server-sourced audit history. External admin-console references are structural inspiration only; BlueTap branding and shared components remain the source of truth.

Accounts & Audit tables use a compact administration-table layout: keep Username, Name, Email, Role, Branch, Status, Last sign-in, and concise actions in the primary desktop table. Put secondary account metadata (created time, onboarding, password setup, source, technical identifiers, and session details) in the shared View/Edit account modal. On small screens, reflow rows into readable cards instead of forcing a giant table. Edit Account must use BlueTap theme tokens and role badges, never colors or branding borrowed from a reference application.

Keep **Create account** and **All accounts** as separate cards; never merge account creation into the listing. Use compact combobox/select controls for desktop filters instead of pill groups intended for quick status actions. Keep the eight-column primary Accounts table compact. Edit Account uses a two-column desktop form where appropriate and minimizes unnecessary vertical spacing. All foreground and background colors must come from shared theme tokens; light mode must never use light foreground text on a light surface.

Admin registration and session policy controls belong on one unified **Security Settings** page. Reuse the existing `/admin/registration-security` route when practical, and avoid separate security sidebar pages unless a genuinely independent workflow requires one.

Admin shells render before business data. Keep navigation, page identity, theme, and logout available while each data section uses layout-matched skeletons or a localized error/retry state. When cached content exists, leave it visible during background refresh instead of replacing the page or section with a full-page spinner.

Forgot Password is a professional BlueTap recovery flow, not a basic reset-link popup. Present clear Email, Verify, New password, and Done steps with masked email, OTP resend/cooldown feedback, and accessible inline errors.

Requester, Distributor, and Manager share the public `/login` interface. Do not add a separate Manager login screen or Manager-login call to action; `/manager/login` may exist only as a compatibility redirect. Keep the Administrator portal separate.

Requester bottom navigation remains a detached, floating rounded pill/card: never replace it with a flat full-width footer. The shared Requester layout must reserve real bottom content space for its height, safe-area inset, and visual margin, so forms, map cards, and final controls remain scrollable above it. Maps and cards must never overflow a parent width: responsive map wrappers use `width: '100%'`, `maxWidth: '100%'`, and `minWidth: 0` where flex layout requires it, with clipping only on the visual rounded map wrapper. Map content must not cause horizontal page scrolling.

Requester and Distributor portal structural sizing is governed by `bluetap-user-portal-ui`.

Requester and Distributor theme behavior is also governed by `bluetap-user-portal-ui`: both roles share one persisted BlueTap theme, use the landing page as the dark-palette and toggle-pattern reference, and must use shared semantic tokens rather than role-specific palettes.

Analytics metric grids must use consistent responsive card bounds so a final or low-count metric such as Issues & Cancelled cannot stretch across an otherwise balanced row.

Analytics dashboards should progress from balanced KPI summaries to compact real-data visualizations and then detailed tables. Visualizations must never fabricate data or combine incompatible units on a misleading axis.

Interactive dashboard cards must expose a real destination and provide accessible keyboard focus plus restrained hover and pressed feedback; decorative cards must not imply navigation.

## Cross-Platform Responsive Visibility Contract

This contract is mandatory whenever adding or modifying UI components across BlueTap: Text, Buttons, Pressables, Inputs, Cards, Views, Containers, Modals, Tabs, Badges, Toolbars, Navigation controls, and List/Table cells.

### 1. Text Visibility Invariants
- Every Text element must use theme-safe foreground colors (`colors.textPrimary`, `colors.textSecondary`, `colors.onPrimary`, etc.) and be verified readable in both Light and Dark modes.
- Never rely on inherited web text colors or browser defaults for critical action labels or tabs.
- Selected and active controls must explicitly define selected text colors (e.g. `#FFFFFF` on filled primary buttons or tabs).
- Text must wrap safely (`flexShrink: 1`, `minWidth: 0`), never overflow parents, and never disappear or blend into backgrounds during selected, hovered, focused, or disabled states.

### 2. Button and Pressable State Contract
- Every interactive element must account for all lifecycle states: `default`, `hover` (where applicable), `focus`, `pressed`, `selected` (where applicable), and `disabled`.
- Critical action labels must remain readable in every state.
- Target a minimum touch area of ~44x44px for touch targets. Avoid text-only interactions unless deliberately designed as inline text links.
- Use explicit semantic styling: `primary`, `secondary`, `success`, `warning`, `danger`.
- **Visible-Disabled over Invisible:** Never hide required next-step action buttons (such as "Confirm", "Submit", "Save") before prerequisite inputs are filled; render them visible with clear, readable disabled styling (e.g. muted semantic tint and legible contrast text), enabling them once prerequisites are satisfied.

### 3. Container Responsiveness and Fluid Layout
- Avoid rigid desktop-only widths. Prefer `flex`, `flexGrow`, `flexShrink: 1`, `minWidth: 0`, `maxWidth`, and `width: '100%'`.
- Containers must never overlap siblings, escape parent boundaries, clip critical action buttons, or induce unmanaged horizontal body scrolling.
- Narrow viewports (< 440px) must intentionally wrap or stack horizontal controls and button rows.

### 4. Text and Long Content Safety
- All dynamic content fields (user names, emails, Public IDs, addresses, order identifiers) must wrap safely.
- Supplemental web styling such as `overflowWrap: 'anywhere'` or `wordBreak: 'break-word'` may be used, but core React Native compatibility (`flexShrink: 1`, `numberOfLines`, `ellipsizeMode`) must remain authoritative.

### 5. Viewport-Safe Modal Contract
Every modal dialog must adhere to a strict three-tier layout:
1. **Fixed Header:** Stable, non-scrolling, with clear title hierarchy and accessible close control.
2. **Scrollable Body:** Must use `flex: 1`, `flexShrink: 1`, `flexGrow: 1` on the `ScrollView` so tall content (such as long option lists) scrolls cleanly without pushing the modal beyond the viewport.
3. **Fixed Footer Actions:** Always visible and reachable, never clipped or pushed offscreen. Must support mobile button stacking (`flexDirection: 'column-reverse'` or wrap) on narrow viewports (< 440px), maintaining touch targets >= 44px.
- The modal wrapper must respect `maxHeight: '90%'` or viewport height bounds with adequate margins on 320px screens.

### 6. Light and Dark Theme Contrast Contract
Every UI modification must be verified in both Light Mode and Dark Mode:
- Validate text, selected tab fills and labels, enabled buttons, disabled buttons, inputs, badges, borders, backgrounds, overlays, and table headers.
- Never use raw hardcoded light or dark colors where semantic tokens (`colors.surface`, `colors.border`, `colors.primaryAction`, `colors.dangerSoft`, etc.) exist.
- If a custom semantic color or tint is necessary, verify contrast meets accessibility standards in both themes (no dark text on dark surfaces, no white text on light surfaces).

### 7. Responsive Breakpoint Matrix
Validate across standard BlueTap breakpoints:
- Narrow Mobile: 320px, 360px, 390px, 430px
- Phablet / Small Tablet: 550px
- Tablet / Small Laptop: 768px
- Desktop / Full Display: 1024px, 1440px
User portals and mobile dialogs prioritize 320–430px stability. Desktop dashboards must provide clean tablet-to-desktop transitions without broken tables or dead whitespace.

### 8. Cross-Platform Parity (Web, Android, iOS)
- Every component must run reliably on React Native Web, Android, and iOS using core React Native primitives (`View`, `Text`, `Pressable`, `TouchableOpacity`, `ScrollView`, `Modal`).
- Never rely on browser-only CSS properties as the sole mechanism for visibility, layout, scrolling, or button placement. Platform web enhancements may supplement, but baseline React Native behavior must remain complete and unbroken.

### 9. Safe Area and Navigation Clearance
- Content and interactive controls must never be obscured by floating navigation pills, sticky headers, mobile browser chrome, software keyboards, or platform safe areas.

### 10. Required Verification Checklist Before Reporting Done
Before declaring any UI task complete, the agent must verify:
1. Light theme contrast & readability
2. Dark theme contrast & readability
3. Narrow mobile viewport (320px–390px) integrity
4. Desktop viewport (1024px+) integrity
5. Button action labels visibly rendered in all states
6. Selected state labels visible with high contrast
7. Disabled state labels clearly readable (not invisible or washed out)
8. No clipping or cut-off action controls
9. No unmanaged horizontal page scrolling
10. Modal headers stable, bodies scrollable, and footers reachable
11. Touch targets >= 44px on mobile
12. Web build and automated regression tests compile cleanly
