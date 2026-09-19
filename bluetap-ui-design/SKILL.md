---
name: bluetap-ui-design
description: Design or refactor BlueTap landing, Admin, or Manager interfaces while preserving the product's shared visual system and existing application behavior.
---

# BlueTap UI Design

Use the existing landing page as the primary branding reference. Inspect current styles and `constants/bluetapTheme.js` before choosing colors; do not introduce arbitrary blue variants.

Admin and Manager screens belong to one dashboard design system. Reuse the shared theme and dashboard components for page shells, navigation, cards, forms, buttons, status badges, loading states, notices, and empty states. Prefer extending shared components over copying styles into individual routes.

Preserve these invariants:

- Use shared tokens for the primary blue, surfaces, borders, text, semantic colors, spacing, radii, and shadows.
- Keep destructive actions red and success states green.
- Pair active-state color with another visual cue such as a border, marker, weight, or icon.
- Keep forms labelled, keyboard accessible on web, visibly focused, and usable at touch sizes.
- At tablet and mobile widths, collapse or reflow navigation, stack cards and form fields, and keep tables horizontally scrollable.
- Do not change authentication, authorization, role checks, branch scoping, backend APIs, OTP, face verification, or other business logic during a visual refactor unless minimal UI wiring requires it.

Before finishing, compare the landing page, Admin shell, and Manager shell for color, typography, radius, card, button, spacing, and responsive consistency. Run the web build and relevant tests.
