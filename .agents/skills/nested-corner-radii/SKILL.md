---
name: nested-corner-radii
description: Apply or review Soma web UI corner radii for nested outer panels and inner surfaces. Use only in the soma repository when adjusting rounded panel/card geometry.
---

# Soma nested corner radii

Use this skill only for the Soma repository's web UI. The shared panel system uses three radius tiers; the module frame has a separate exception below:

- **Radius 1 (workspace/panel):** the 24px workspace and main panel surfaces.
- **Radius 2 (inner):** a bordered surface inset inside Radius 1.
- **Radius 3 (detail):** a bordered surface inset inside Radius 2.

## Geometry rule

For nested surfaces intended to follow the same smooth curve, measure the inset from the **parent surface's outer box edge** to the outside edge of the child border, then relate adjacent radii to that inset:

`parent radius = child radius + inset`

Equivalently, `child radius = max(0, parent radius - inset)`. Apply the rule recursively for each adjacent tier; do not compare non-adjacent tiers directly. The inset is the design spacing inside the parent surface; include any visible outline that sits on the parent edge, but do not count an inset stroke twice. If the spacing changes, update every paired radius together. Do not choose radii independently: when the radius difference is much smaller than the inset, the corner arcs drift apart and the band between them looks uneven.

## Soma values

The project's 48px reference diameter sets the main geometry:

- Reference diameter: `--reference-diameter: 48px` (also the fixed `.app-menu-bar` height)
- Radius 1: `--panel-radius: 24px` (half the reference diameter)
- Radius 2: `--inner-radius: 14px`
- Radius 3: `--detail-radius: 4px`
- Nested inset between adjacent surfaces: `--panel-padding: 10px`

The nested panel surfaces retain 10px padding and the 24px → 14px → 4px radius sequence. The module frame is the only exception: `.module-content` has a fixed 24px radius, and `.module-page` supplies its 6px left, right, and bottom outer spacing at every viewport size. Keep this frame spacing independent of `--panel-padding: 10px`. `.model-space` fills `.module-content` at `inset: 0` and inherits its radius; Anatomy fills that workspace without another frame inset. Draw the panel's 1px outline with an inset shadow, not a CSS border, so the outline does not add to the layout inset. In the catalog panel, align `.catalog-heading`, `.structure-search-field`, `.tree-actions`, and `.catalog-tree` to the shared inset; the search field and tree use Radius 2, while separate action buttons keep their control radius. `.tree-row.folder-row` uses Radius 3 inset 10px inside `.catalog-tree`; because the tree has a 1px border, set its CSS padding to 9px. Within Radius 2 information content, use Radius 3 for bordered details such as `.wikipedia-article`, `.model-credit-description`, and `.reference-mapping-description`. Keep the shared values in `apps/web/src/style.css`; do not duplicate the paired radii as unrelated literals.

`.explode-control` is a standalone panel surface and uses Radius 1.

## Button and control design rules

Standard `<button>` elements and compact interactive controls across the interface follow unified geometry and proportions:

- **Action buttons (`<button>`, links styled as buttons, status chips):**
  - **Height / min-height:** `28px`
  - **Corner radius:** Radius 2 (`--inner-radius: 14px`), producing a smooth, fully-rounded pill silhouette (`radius = height / 2`).
  - **Padding:** `6px 10px` (or `3px 10px` when vertically centered).
  - **Typography:** `font-size: 12px`.
- **Icon-only buttons (`<button>` icon targets):**
  - **Dimensions:** `28px × 28px` square, with Radius 2 (`14px`) rendering a circular button.
  - **Icon size:** `14px` to `16px`, centered.
- **Associated inline inputs:**
  - Single-line text inputs directly paired alongside 28px buttons adopt the same `28px` height, Radius 2 (`14px`), and compact font size for visual harmony.
- **Concentric corner alignment:**
  - When a 28px button sits inset `10px` inside a Radius 1 (`24px`) panel or viewport corner, it satisfies the geometric rule:
    `parent radius (24px) = child radius (14px) + inset (10px)`
- **Exceptions:**
  - Layout shells: The top `.app-menu-bar` uses the 48px reference diameter (`--reference-diameter: 48px`) and Radius 1 (`24px`). The page shell `.module-header` uses a compact 40px height to maximize viewport space, with centered 28px controls, navigation links, and toggle buttons conforming to the standard 28px / Radius 2 (`14px`) proportion.
  - Stacked list/tree rows: Interactive rows within structured trees or lists (`.tree-row`, `.folder-row`) are list items rather than pill buttons; they use Radius 3 (`--detail-radius: 4px`) or `--row-radius`.

The tier rule applies when a bordered child surface sits in a parent corner with a measured inset, such as `.catalog-panel` and `.catalog-tree`, then recursively to a detail surface inside Radius 2. Do not apply it to unrelated controls just because they are inside a panel; the transparent toolbar icon buttons are interaction targets, not nested surfaces.

## When adjusting the layout

1. Identify the parent and child surfaces and measure the inset from the parent's inside edge to the child's border; exclude the parent's border width.
2. Set the child radius and derive the parent radius from the inset, or preserve the parent and derive the child radius.
3. Check that left, right, and bottom insets match when the layout calls for an evenly framed inner surface.
4. Inspect the rendered corners at normal scale. CSS border widths and clipping can affect the visible curve; make a small correction only when the rendered edges show it.
5. Preserve existing component behavior and responsive breakpoints. Report viewport sizes that were not visually checked.
