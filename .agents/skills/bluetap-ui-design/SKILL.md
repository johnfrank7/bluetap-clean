---
name: bluetap-ui-design
description: Design or refactor BlueTap landing, Admin, or Manager interfaces while preserving the product's shared visual system and existing application behavior.
---

# BlueTap UI Design

Use the existing landing page as the primary branding reference. Inspect current styles and `constants/bluetapTheme.js` before choosing colors; do not introduce arbitrary blue variants.

Admin and Manager screens belong to one dashboard design system. Reuse the shared theme and dashboard components for page shells, navigation, cards, forms, buttons, status badges, loading states, notices, and empty states. Prefer extending shared components over copying styles into individual routes.

Admin navigation uses a shared collapsible sidebar: keep desktop transitions subtle and fast, use an off-canvas drawer with a backdrop on small screens, and preserve icons plus accessible labels when collapsed. Admin theme preferences support Light, Dark, and System through shared global tokens; BlueTap primary remains the source of truth. Confirm logout in the shared shell, clear only auth/session state on confirmation, and allow harmless UI preferences such as theme and sidebar state to persist.

BlueTap dark mode uses layered deep navy and blue-black surfaces, never pure black as the main background. Keep BlueTap blue as the primary accent; Admin and Manager share one dark palette through theme tokens, while the landing page remains the branding reference. Build premium card separation with subtle borders and restrained highlights. Do not introduce random hardcoded dark colors in screens: use the shared background, sidebar, surface, surfaceAlt, border, primary, text, muted, and semantic tokens.

Preserve these invariants:

- Use shared tokens for the primary blue, surfaces, borders, text, semantic colors, spacing, radii, and shadows.
- Keep destructive actions red and success states green.
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
