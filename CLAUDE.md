# CLAUDE.md — FlowSketch Studio

Browser-based editor for hand-drawn flow diagrams that gently animate: shapes float, wobble or "boil", and arrows show flow with a travelling highlight, draw-on, marching dashes or pulse. It saves editable `.flowsketch` files and exports animated GIF, video, PNG/JPEG, SVG and a standalone HTML player. Everything runs locally in the browser; there is no backend and no account.

Owner: Angus (macOS, technically capable). The repo is `github.com/bagcheap/FluidFlowSketchStudio`.

## Commands

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run build        # rebuilds the HTML-player bundle, type-checks (tsc --noEmit), then vite build → dist/
npm run preview      # serve dist/ on :4173
npm test             # Vitest unit tests (tests/*.test.ts), must stay green
npm run typecheck
npm run build:player # rebuild src/player/player.bundle.js (needed only after engine changes)
```

End-to-end checks are in Python with Playwright and Pillow, and drive the real UI:
`npm run build && npx vite preview --port 4173 &` then `python3 e2e/run_e2e.py http://localhost:4173/ <out_dir>`.
`python3 e2e/make_samples.py` regenerates `samples/*.flowsketch` and `samples/*.gif` through the UI.

Before saying a change is done: `npm run typecheck`, `npm test`, and for UI or interaction changes, run the e2e suite or at least check the behaviour in the browser.

## Stack

React 18 + TypeScript (strict) + Vite, Zustand for state, Rough.js for sketch geometry, gifenc in a Web Worker for GIFs, idb-keyval for IndexedDB, Lucide icons, Kalam (hand) and Inter fonts via @fontsource.
UI styling is **plain CSS with design tokens** in `src/styles.css`. There is no Tailwind. Menus and dialogs are **hand-written accessible components**, not Radix. Keep it that way unless asked.

## Architecture

```
src/model/       types.ts (document schema) · defaults.ts (defaults, palettes, makeShape/makeConnector) · schema.ts (validate / sanitise / migrate / serialize)
src/engine/      noise.ts · shapes.ts · rough.ts · animation.ts · connectors.ts
                 render.ts         renderDocumentAtTime(doc, t) → Frame   ← single source of truth
                 canvasRenderer.ts Frame → canvas (live view, GIF, PNG, video, player)
                 svgExport.ts      Frame → SVG string
                 text.ts           shared text measurement and wrapping
src/store/       docStore.ts (document + undo/redo) · uiStore.ts (tool, prefs, selection, view, playback, confirm dialog) · commands.ts (all editor actions)
src/editor/      Canvas.tsx (render loop + every pointer interaction) · TextEditor.tsx · hitTest.ts
src/ui/          TopBar + MenuBar, Toolbar, Inspector, Timeline, controls.tsx, shortcuts.ts, dialogs/*
src/export/      gif.ts + gif.worker.ts · raster.ts · video.ts · staticExport.ts
src/persistence/ storage.ts (IndexedDB autosave, recents, custom templates) · files.ts (open/save, File System Access + download fallback)
src/player/      main.ts → built to player.bundle.js (committed), embedded into exported HTML
src/templates/   samples.ts (7 built-in sample diagrams, generated in code)
```

### Rules that must not be broken

1. **Animation never mutates the document.** `renderDocumentAtTime(doc, t)` in `engine/render.ts` is pure and deterministic. Live playback, every export and the HTML player call it, so the preview and exports match. Never write animated positions back into saved coordinates.
2. **Hit-testing, selection handles and connector editing use STATIC geometry**, never animated geometry. They live in the SVG overlay in `Canvas.tsx` and in `hitTest.ts`.
3. **Seamless loops:** temporal frequencies are snapped to whole cycles per loop (`snapFreq` in `noise.ts`). Squiggle intensity 0 must be *exactly* still. Motion must be continuous; there are unit tests for this.
4. **Static roughness (Style.roughness) and animated squiggle (anim.intensity) are independent settings.**
5. **Connectors are real relationships** (`Endpoint.elementId` + optional `anchor`), resolved against the *animated* target transform so arrows stay attached while shapes move.
6. **Rough.js geometry is generated once and cached** (`engine/rough.ts`) per geometry, style and seed. Each frame only transforms or warps it. Don't regenerate paths per frame.
7. **Imported files are untrusted.** Everything goes through `parseDocument` in `model/schema.ts`: coerce every field, raster-only images (no SVG), detach dangling references, no executable content. Bump `SCHEMA_VERSION` and add a `migrate()` case for any format change.
8. **Undo/redo:** use `commit(fn, coalesceKey?)` for discrete edits (rapid slider changes coalesce on the key). Use `begin()` / `live()` / `end()` (or `cancel()`) for drags, so one gesture is one history entry.
9. **No native `alert` / `confirm` / `prompt`.** They don't work in sandboxed hosts. Use `useUI.getState().ask(message, okLabel)`, which returns `Promise<boolean>` and renders `ConfirmDialog` in `App.tsx`. `confirmDiscard()` is async.

## Product decisions already made (keep them)

- **Continuous drawing:** a drawing tool stays active after each shape. A single `Esc` always returns to the Select tool (arrow pointer, V): mid-gesture it also cancels the gesture; in the text editor it also commits the text; it also closes the More-shapes pop-up. Esc pressed in an inspector input also blurs the field and returns to Select. With Select already active, Esc clears the selection.
- **Tooltips:** toolbar tools show name, shortcut and a one-line how-to (`tip` in `Toolbar.tsx`); colour swatches show a colour name plus hex (`colorLabel` in `ui/colorNames.ts`). Swatch `aria-label`s stay `<label> <hex>` because the e2e tests click by them.
- **Remembered styles per tool** (`prefs.toolStyles`, keyed `shape:<kind>`, `arrow`, `line`, `text`, …), persisted in localStorage. With a tool active, the inspector edits that tool's defaults. With objects selected, it edits those objects, **and** (pref `selectionUpdatesDefaults`, on by default) copies the new style into that tool's defaults. Existing objects never change when defaults change. There is an optional shared style across shape tools.
- **Dark theme does NOT invert the canvas.** The diagram always shows its true colours (what you see is what you export). Dark theme only restyles the app's interface. Users who want a dark canvas pick a dark canvas background.
- **Palettes** (`model/defaults.ts`): a 10-column grid of neutrals plus 10 hues, in tint, light, bold and deep strengths, plus recent colours and hex/native picker. The e2e tests click swatches by aria-label, for example `Stroke colour #1864ab`. Update the tests if you change palette values.
- **Welcome card** shows only on a fresh empty canvas. It can be dismissed (✕ / "Start with a blank canvas" / picking any drawing tool). File ▸ New diagram always gives a blank canvas with no card.
- **Swap direction** (`cmd.swapDirection`; Inspector Connector section and Arrange menu) reverses arrows in place: ends trade places, bends reverse, and curvature/label position/offset are mirrored so the route and label stay where they were. One undo step; locked arrows are skipped.
- **Request ⇄ response arrow pairs** were built and parked on the branch `claude/request-response-arrows` (not merged; it also bumps the file format to v2). Pick it up from there if wanted later.
- Default arrow animation is the travelling highlight. Glow is drawn as translucent wide strokes, not blur filters, for speed.
- Live view culls off-screen elements, and the grid is a cached canvas pattern.
- Theme toggle: the top-bar sun/moon button cycles Light → Dark → System. It is also in View ▸ Theme and Edit ▸ Preferences.

## Versions and the changelog

- `CHANGELOG.md` (Keep a Changelog format) is the single source of release notes. The app shows it in Help ▸ What's new (`ui/changelog.ts` parses it; keep to `## [x.y.z] - YYYY-MM-DD`, `### Added|Changed|Fixed`, `- ` bullets, `**bold**`).
- Every user-visible change adds a line under `## [Unreleased]` at the top (create the section when it is missing; never leave it empty), written for users, not developers (developer-only changes such as tests or tooling are left out).
- A version bump (`npm version x.y.z --no-git-tag-version`) renames `[Unreleased]` to `[x.y.z] - <date>`. `tests/changelog.test.ts` fails if the `package.json` version has no dated entry.
- The About dialog reads the version from `package.json`; never hard-code it.

## Testing conventions

- Unit tests are in `tests/` (Vitest + jsdom): engine determinism and continuity, connectors, schema round-trip and sanitising, history, tool styles.
- `src/main.tsx` exposes a **read-only** `window.__flowsketch` hook (`doc`, `ui`, `toolStyle`, `frame(t)`, `connectorEnds`, `pause`, `setView`, `benchRender`, `measureFps`, `history`) used by the e2e tests. Keep it working and read-only.
- Stable test selectors: `data-testid` = `stage`, `play`, `open-sample`, `start-blank`, `gif-export`, `confirm-ok`. Templates use `data-template=<id>`.
- E2E opens files with `delete window.showOpenFilePicker` so the `<input type=file>` fallback (attached to the DOM in `pickFile`) is exercised.

## Known limitations / deferred work

- 60 FPS with 100 shapes + 150 connectors was not demonstrated. It measured about 22 FPS in headless software rendering; this needs checking on real hardware. Dragging while playing a huge document is slow.
- Deferred: AI text-to-diagram (intended to plug into `store/commands.ts` as structured, validated edits; it must never execute generated code), keyframes, easing, timeline tracks, auto-layout, Find, rotating multi-selections, direct drag of connector labels, per-word bold/italic.
- Transparent GIFs use 1-bit alpha (faint fringe on edges). Video export records in real time.
- Hachure fills regenerate when a shape is resized.

## How Angus likes to work

- When delivering changes outside this repo (for example from a chat), send **only the changed files**, not the whole project.
- Keep explanations short and concrete. Say plainly what changed and what was verified.
- Mention when a change needs `npm install` or new files. A missing file once broke `npm run dev`. `predev` was removed for that reason: `npm run dev` must not depend on rebuilding the player.
