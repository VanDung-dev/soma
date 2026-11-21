---
name: browser-verification
description: Verify rendered Soma web UI, interactions, accessibility state, console output, or network behavior in a real browser. Use when a task needs web-page verification.
---

# Browser verification

Use this skill when a task requires checking rendered pages, layout, interactions, console output, network failures, or screenshots. Do not use it for source reading, static inspection, or tasks with no rendered-page check.

## Browser and setup

- Use the available Puppeteer MCP integration or an existing `puppeteer`/`puppeteer-core` dependency first. Reuse the project's configured browser binary.
- If Puppeteer is unavailable, do not add dependencies or download a browser. Ask the user to install Puppeteer and its browser using the instructions at [pptr.dev](https://pptr.dev/).
- Run checks headless against the local dev server, such as `apps/web`, and record relevant evidence: console errors, failed requests, DOM or accessibility state, and screenshots when useful.
- Stop any dev server and browser process started for the check.

## Interaction checks

- Compare observed behavior with the expected behavior and report both.
- For focus behavior, check pointer focus, Tab navigation, Escape, and focus restoration in light and dark themes. Confirm focus remains usable without a visible ring or text underline.
- Inspect responsive layouts at the relevant viewport sizes and report any sizes or states not checked.
