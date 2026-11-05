# Browser verification with Puppeteer

- When a task requires checking a web page — layout, rendering, interactions, console output, network failures, or screenshots — use Puppeteer first instead of describing the page from source, using `curl`, or asking the user to look at it.
- Prefer an existing Puppeteer integration before proposing an install: the Puppeteer MCP tools, or `puppeteer`/`puppeteer-core` already present in the workspace. Reuse the project's browser binary when one is configured.
- If Puppeteer is not available, stop and ask the user to install it following https://pptr.dev/. Name the install command and the browser it downloads, and wait for approval; do not add dependencies or download a browser without consent.
- Run checks headless against the local dev server (for example `apps/web`) and record real evidence: console errors, failed requests, DOM or accessibility state, and screenshots when useful.
- Report what was observed versus what was expected, and stop the browser and any dev server started for the check.
- Do not use Puppeteer for source reading, static file inspection, or tasks with no rendered page; those stay with code and repository tools.
