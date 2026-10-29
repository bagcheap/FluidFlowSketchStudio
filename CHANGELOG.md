# Changelog

All notable changes to FlowSketch Studio, newest first. The same list appears in the app under Help ▸ What's new.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each version has up to three groups: **Added** for new features, **Changed** for changes to existing behaviour, and **Fixed** for bug fixes.

## [0.1.2] - 2026-10-29

### Added
- **What's new:** Help ▸ What's new shows this list of changes in the app.

## [0.1.1] - 2026-10-29

### Added
- **Tooltips:** toolbar tools show their name, shortcut and a one-line how-to. Colour swatches show a colour name with its code, for example "Dark blue · #1864ab".
- **Swap direction** for arrows (Inspector, or Arrange ▸ Swap arrow direction) reverses an arrow without redrawing it. Its curve and label stay where they were.

### Changed
- **Esc always returns to the Select tool in one press**, also while drawing (the shape is cancelled), while typing (the text is kept) and with the More shapes pop-up open.
- The About dialog shows the real version number.

### Fixed
- **Text tool:** clicking on the canvas opens a text box you can type in (it used to disappear straight away). Clicking from one text box to the next works, a new text box is a single undo step, and an empty one you abandon leaves nothing in the undo history.
- Alt-drag copies get their own group instead of joining the original's, and are never locked.
- Animated GIFs play for exactly the loop length (a 2.5 s loop used to play as 2.53 s).
- GIF export shows an error with Retry if the encoder crashes, instead of freezing.
- The GIF export dialog frees the memory used by its result previews.
- Edit ▸ Paste pastes text copied in another app, even after you copied shapes in FlowSketch.
- Locked objects are no longer changed by Paste style, the format painter, Flip or animation presets, and Enter no longer opens their text for editing.

## [0.1.0] - 2026-10-12

First version: a browser editor for hand-drawn flow diagrams that gently animate.

### Added
- 16 hand-drawn shapes, text, freehand pen, highlighter and images, with remembered styles per tool.
- Arrows that stay attached to shapes, with straight, curved and elbow routes and labels.
- Shape motion (float, wobble, boil, sway) and arrow flow (travelling highlight, draw-on, marching dashes, pulse), with seamless loops.
- Export to animated GIF, video, PNG/JPEG, SVG and a standalone HTML player.
- Editable .flowsketch files, autosave in the browser, recent documents and templates.
