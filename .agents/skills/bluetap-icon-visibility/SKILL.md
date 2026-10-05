---
name: bluetap-icon-visibility
description: Preserve visible, theme-safe BlueTap icons, brand marks, navigation glyphs, notification controls, Assistant imagery, chat icons, and empty-state artwork across web and native UI work.
---

# BlueTap Icon Visibility

Use this skill whenever UI work adds, replaces, recolors, animates, or restructures a user-visible icon or image-backed control.

## Scope

This covers navigation, headers, notification controls, icon-only buttons, SVGs, icon fonts, image-backed icons, BlueTap brand marks, Assistant and chat imagery, status symbols, and empty-state artwork across every role.

## Invariants

1. Critical icons never rely on inherited color. Resolve an explicit semantic foreground such as `iconPrimary`, `iconSecondary`, `iconOnPrimary`, `iconMuted`, `iconDanger`, `iconWarning`, `iconSuccess`, or `iconInteractive`.
2. Every interactive icon has an accessibility label on its owning control and remains visible in normal, hover, focus, pressed, selected, loading, and disabled states.
3. Verify both light and dark themes. White icons belong only on guaranteed primary/dark surfaces; dark icons belong only on guaranteed light surfaces.
4. Icon frames retain explicit non-zero width and height. Responsive changes may not collapse or clip them.
5. Prefer the shared `BlueTapIcon` and `BlueTapBrandMark` contracts when an existing raster asset needs semantic tinting or an error fallback. Do not render imported module objects as elements.
6. Pass image tint through the supported `Image` `tintColor` prop. Do not add new `style.tintColor` usage.
7. Shared navigation icons remain visible after theme transitions. Active state uses an additional cue such as a surface, ring, marker, or weight; inactive state remains readable.
8. Empty states must show context-relevant artwork or a built-in fallback, plus a title and supporting text. Never leave a blank colored icon square.
9. Preserve official BlueTap logo assets. If an asset cannot resolve, render the shared built-in brand fallback rather than an empty reserved frame.
10. Preserve role and avatar identity. Do not replace user initials or role-specific presentation with generic icons.
11. Press, hover, animation, and disabled styling may dim an icon but may not reduce it to invisibility.
12. Theme-transition overlays must not mutate permanent icon colors or leave icons in an intermediate theme.
13. Avoid platform-dependent emoji for critical interface icons when a BlueTap asset or deterministic fallback exists.
14. Do not add a new icon package for a focused fix when the shared assets and code-native fallbacks are sufficient.
15. Run the icon regression tests after relevant Codex or Antigravity edits.

## Verification

At minimum verify Requester, Distributor, and Manager in light and dark themes at mobile and desktop widths. Include Login and Admin when shared brand, theme, or privileged-shell components changed. Check asset renderability, explicit semantic foregrounds, non-zero sizing, image fallback behavior, active/inactive navigation, badges, reduced motion, and `git diff --check`.
