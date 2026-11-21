# No focus rings

- All application UI uses ring-free focus, including browser, Tauri, Home, Anatomy, popovers, and portals.
- Never add visible focus outlines, outline offsets, focus borders, box-shadow rings, filter rings, or pseudo-element frames for `:focus`, `:focus-visible`, `:focus-within`, or equivalent state classes.
- Show keyboard focus with existing background tokens. Never use text underlining as focus styling. Keep actual focus, Tab navigation, accessible names, and focus restoration; never use `blur()` to hide focus styling.
- Use the shared focus policy in `apps/web/src/style.css`. Component styles must not reintroduce rings. Ordinary layout borders and model-selection rendering retain their own semantics.
- For rendered focus checks, use `.agents/skills/browser-verification/SKILL.md`.
