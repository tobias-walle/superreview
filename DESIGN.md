# Superreview design

A dense, calm workspace for reading code and giving precise feedback. The diff is the primary surface. Use shadcn-style controls, thin borders and restrained depth.

## Visual language

- Use the shared semantic tokens in `client/globals.css`. Support Catppuccin Mocha and Latte together; avoid literal colors in components.
- Use mauve for actions, focus and selection. Reserve green/red for added/deleted code. Pair color with signs, labels or icons.
- Keep UI text compact and code monospaced. Preserve code alignment. Use subtle whole-line fills and stronger word highlights.
- Prefer small spacing, consistent radii and quiet surfaces. Keep touch targets usable even when visible icons are small. Avoid decorative gradients and oversized headings.

## Layout and interaction

- Desktop: file tree left, continuous diff center, resizable comments overview right. Keep file headings and navigation easy to find while scrolling.
- Unified and split views share selection, comments and progress. Switching layout must not reset the review.
- Mobile: default to unified; use drawers for files/comments and a bottom sheet for the editor. No page-wide horizontal overflow. Keep explicit desktop simulation with a clear return action.
- Support single-line and range comments through Shift-click and tap-based range controls. Show side and line range before writing. Keep drafts when closing the editor.
- Distinguish pending feedback, resolved threads, viewed files and historical snapshots. These are different states.
- Show the author on each message. Give agent messages a visible Agent badge. A custom display name must not hide the badge.
- Keep an agent's report separate from human resolution. An agent reply must not resolve a thread.
- Submit freezes a feedback round. Copy is a separate action after submission and remains available in History. Never combine copy and submit.
- Use existing accessible primitives, visible focus, named icon buttons and reduced-motion support. Keep primary actions reachable in small viewports.

## Check before shipping

Inspect both themes at desktop and narrow mobile widths. Exercise long paths, wrapped code, empty comparisons, range selection, editor preview, nested dialogs and submission history. Check scroll position, tree sync and visible-line coverage after layout changes. Virtualization must not hide active editors or count offscreen content as viewed.
