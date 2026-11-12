---
name: nested-corner-radii
description: Apply or review Soma web UI corner radii for nested surfaces. Use only in the Soma repository when adjusting rounded panel or card geometry.
---

# Soma nested corner radii

Use this skill for corner geometry in the Soma web UI, including the shared UI rendered by the desktop app. Read the component styles before applying the guidance; the radius tokens describe the visual language, not a requirement that every rounded element use the same radius.

## Design language

- `apps/web/src/style.css` owns the shared light/dark palette, surface colors, spacing tokens, and radius tokens. `apps/web/src/fonts.css` defines Lato for UI text and Merriweather for display text.
- The shared reference diameter is `48px`. The nested surface tokens derive a `24px` panel radius, `14px` inner radius, and `4px` detail radius using `--panel-padding: 10px`.
- `--panel-inset` and `--panel-gap` are layout spacing (`16px`); they are not the inset in the radius calculation unless the actual painted surfaces are that far apart.
- Many compact controls are `28px` tall and use the inner radius, but dimensions and radii vary by component. This skill does not set universal button, input, row, or typography sizes.

## Geometry rule

Apply the concentric rule only when the child surface is meant to continue the parent corner's curve. Measure the shortest inset between the painted outer edges of the parent and child surfaces, then derive the child radius from that inset:

`child radius = max(0, parent radius - painted inset)`

Apply this between adjacent nested surfaces only. Account for the real box model: CSS borders occupy space, inset shadows do not, and padding alone may not equal the visible inset. Do not count the same border or shadow twice. If the component's surfaces are not concentric, choose radii by their semantic role and surrounding component styles instead of forcing the formula.

Keep paired values connected through the shared CSS custom properties where they form the same surface system. Do not copy the current `24px → 14px → 4px` values into unrelated components as literals. Re-evaluate the derived values whenever the parent radius or actual inset changes.

## Existing patterns and exceptions

- `.app-menu-bar`, `.workspace-panel-surface`, `.catalog-panel`, and `.information-panel` use the panel radius. Inset content surfaces such as `.catalog-tree` and `.information-content` use the inner radius. Bordered details such as `.wikipedia-article` and `.reference-mapping-description` use the detail radius.
- `.catalog-tree` has a `1px` border and `9px` padding. Together they make a `10px` content inset for rows that use the detail radius inside the inner-radius tree.
- Lesson cards use the panel radius, but their child geometry depends on the component: the general card uses `20px` padding with a detail-radius cover; the library card overrides to `10px` padding and an inner-radius cover.
- `.module-page` has `6px` outer padding and `.module-content` has a separate `12px` radius. `.model-space` fills that content and inherits its radius. This is a shell-specific pattern, not the shared panel-radius tier.
- `.explode-control` is a standalone panel and uses the panel radius. Standalone status surfaces, controls, rows, popovers, circles, and overlays may use other radii according to their component styles.

## When changing a component

1. Identify the actual parent and child painted boxes in the component CSS, including borders, inset shadows, padding, clipping, and responsive overrides.
2. Decide whether the corners are intended to follow the same curve. If so, measure the painted inset and derive adjacent radii; otherwise use the existing semantic token or component pattern.
3. Prefer the shared radius token when the surface belongs to that token's tier. Keep documented shell-specific values local to their component.
4. Check that corner dimensions remain valid for the element's width and height and that borders or clipping do not distort the intended curve.
5. For rendered UI work, inspect the changed corners at normal scale, relevant responsive sizes, and both themes. Report any viewports or states not checked.
