# Superreview design

A dense, calm workspace for reading code and giving precise feedback. The diff is the primary surface. Use shadcn-style controls, thin borders and restrained depth.

## Visual language

- Use the shared semantic tokens in `client/globals.css`. Support Catppuccin Mocha and Latte together; avoid literal colors in components.
- Use mauve for actions, focus and selection. Reserve green/red for added/deleted code. Pair color with signs, labels or icons.
- Keep UI text compact and code monospaced. Preserve code alignment. Use subtle whole-line fills and stronger word highlights. Word highlighting stays enabled without a toolbar toggle.
- Prefer small spacing, consistent radii and quiet surfaces. Keep touch targets usable even when visible icons are small. Avoid decorative gradients and oversized headings.

## Layout and interaction

- Desktop: file tree left, continuous diff center, resizable comments overview right. Keep file headings and navigation easy to find while scrolling.
- The tree, continuous diff, counter and sequential navigation share one folder-grouped file order. Collapsing tree folders does not skip their files. Scrolling and navigation stop at the ends without wrapping or jumping to unread files.
- Unified and split views share selection, comments and progress. Switching layout must not reset the review.
- Unified offers “Hide deletions”: show context and additions with new-side numbers only. Split always shows both sides. Keep deleted files discoverable with a Show deletions action. Opening an old-side comment or draft from the overview reveals deletions. Hidden lines never count as viewed.
- Mobile: default to unified; use drawers for files/comments and a bottom sheet for the editor. No page-wide horizontal overflow. Keep explicit desktop simulation with a clear return action.
- Clicking a line number opens a comment directly. Avoid overlapping gutter actions. Dragging line numbers opens it on release. Shift-click adjusts a new draft's range around its original starting line without losing text. Plain clicks elsewhere preserve the previous draft. Replies and existing thread anchors never move.
- Show side and line range while writing. On mobile, provide start/end line fields for visible snapshot lines. Keep drafts when closing the editor.
- Keep comments compact: thread actions share the header, with labelled icons on mobile. Editors use plain Markdown textareas without preview tabs. Inline desktop editors omit the repeated path, while mobile and standalone editors retain it.
- Distinguish pending feedback, resolved threads, viewed files and historical snapshots. These are different states.
- Show the author on each message. Give agent messages a visible Agent badge. A custom display name must not hide the badge.
- Keep an agent's report separate from human resolution. An agent reply must not resolve a thread.
- Submit freezes a feedback round. Copy is a separate action after submission and remains available in History. Never combine copy and submit.
- Use existing accessible primitives, visible focus, named icon buttons and reduced-motion support. Keep primary actions reachable in small viewports.

## Check before shipping

Inspect both themes at desktop and narrow mobile widths. Exercise long paths, wrapped code, empty comparisons, range selection, draft editing, nested dialogs and submission history. Check scroll position, tree sync and visible-line coverage after layout changes. Virtualization must not hide active editors or count offscreen content as viewed.
