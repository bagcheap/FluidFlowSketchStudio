# Changelog

All notable changes to FlowSketch Studio, newest first. The same list appears in the app under Help ▸ What's new.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each version has up to three groups: **Added** for new features, **Changed** for changes to existing behaviour, and **Fixed** for bug fixes.

## [Unreleased]

### Added
- **Round-trip arrows:** with the travelling highlight, set Direction to ⇄ Round trip and the highlight travels to the end of the arrow and back again, in a different colour on the way back (blue out, pink back by default). It shows a request and its response on one arrow. Choose the return colour and how long it waits at the far end in the Inspector.

### Changed
- Files now use format version 5. Older files open as before, but files saved with this version need this version of FlowSketch or later.

## [0.1.6] - 2026-10-31

### Added
- **Right-click menu:** right-click an object for cut, copy, paste, duplicate, delete, styles, containers, grouping, order, alignment, swap direction and lock; right-click empty canvas for paste, select all, the grid (dots, lines or plain), snapping, zoom, icons and default styles. Shift+F10 opens it from the keyboard.
- **Containers:** select shapes and choose Add container (right-click, Arrange or Insert) to put a titled frame around them. Moving the container moves everything inside; shapes moved, drawn or pasted inside join it, and shapes dragged out leave it. It grows to fit, Fit to contents shrinks it back, and Remove container keeps what was inside. Deleting a container deletes its contents too (Undo brings them back). Drag a container by its title bar or border; drag across its empty inside to select shapes in it.
- **Default styles are easier to manage:** Set as default style and Reset default style in the right-click and Edit menus, Reset all default styles in Edit, and a reset button in the Inspector while a drawing tool is active.

### Changed
- Files now use format version 4. Older files open as before, but files saved with this version need FlowSketch 0.1.6 or later.

## [0.1.5] - 2026-10-31

### Added
- **Cloud provider icons:** under Icons ▸ Add icons, a Cloud provider icons section links to the official AWS, Microsoft Azure and Google Cloud icon downloads. Choose the ZIP you downloaded and FlowSketch turns it into a library: one icon each (the largest size, light version), with readable names and grouped by category (Compute, Storage, …). Importing a newer package offers to replace the old library. The icons stay in your browser and follow the terms you accepted when downloading them.
- Any ZIP of SVG icons can be added to a library, and a ZIP dropped on the canvas becomes a library. Large packages show their progress while importing.
- Licensing notes: Help ▸ About and the new THIRD_PARTY_NOTICES.md list the included icon sets and their licences, and explain that logos are trademarks of their owners and that cloud provider icons are not included.

### Fixed
- The Show links in the Icons panel no longer get cut off at the panel's edge.

## [0.1.4] - 2026-10-30

### Added
- **More icon sets:** Devicon (1,079 programming languages and developer tools), SVG Logos (2,043 company and product logos in colour), Simple Icons (3,467 one-colour brand marks) and Kubernetes (38 resource icons), alongside Tabler. Filter by set with the chips at the top of the Icons panel, or search all of them at once. Each set downloads the first time you open or search it.
- **Your own icons:** in the Icons panel, choose Add icons to add SVG, PNG, JPEG, GIF or WebP files, a whole folder, or an Iconify JSON icon set to a library. Libraries are kept in this browser; rename, export (as a .flowsketchlib file to share with your team) or delete them under Manage, and switch built-in sets on or off there.
- Drop an SVG file onto the canvas to use it as an icon, or drop a .flowsketchlib file to add it as a library.

### Changed
- Colour icons keep their gradients, so logos look as their makers designed them.
- Files now use format version 3. Older files open as before, but files saved with this version need FlowSketch 0.1.4 or later.

## [0.1.3] - 2026-10-30

### Added
- **Icons:** an Icons panel on the left (toolbar button, Insert ▸ Icons, or Shift+I) with the 6,257 Tabler Icons. Search by name, then drag an icon onto the canvas or click to add it. Recently used icons are listed first.
- Icons work like shapes: arrows attach to them, they can have a label (below or to the right), and they float and wobble with the animation. In the Inspector you can recolour them, draw them hand-drawn, and give them a circle or square background.
- Icons stay sharp at any zoom and in every export, and are saved inside the .flowsketch file, so diagrams open anywhere.

### Changed
- Files now use format version 2. Older files open as before, but files saved with this version need FlowSketch 0.1.3 or later.

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
