# Changelog

All notable changes to FlowSketch Studio, newest first. The same list appears in the app under Help ▸ What's new.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each version has up to three groups: **Added** for new features, **Changed** for changes to existing behaviour, and **Fixed** for bug fixes.

## [0.1.29] - 2026-11-13

### Fixed
- **Rounded elbow arrows no longer get a sharp corner next to a shape.** On an arrow with a set route (from Route arrows around shapes, a Mermaid import or dragging its segments), the corner closest to each end could turn sharp while the shapes floated, because the arrow's end moved a few pixels but its route didn't. The route now stays lined up with its ends, so every corner keeps its radius.

## [0.1.28] - 2026-11-13

### Fixed
- **Save writes back to your file again after reopening.** FlowSketch now remembers which file each diagram came from, so File ▸ Save keeps saving to that file after the app (or the browser tab) is closed and reopened, or when you reopen the diagram from Recents, instead of asking where to save as if it were Save as. In the desktop app the permission to write files you chose is now kept between launches. In Chrome and Edge, the first Save after reopening may ask once whether FlowSketch may edit the file. (Safari can't write back to files at all, so there Save always downloads a copy — use the desktop app or Chrome to save in place.)
- **Moving a shape re-routes its arrows.** Elbow arrows with a set route (from Route arrows around shapes, a Mermaid import or dragging their segments) no longer cling to their old waypoints when you move or resize a shape they're attached to, which gave kinks and arrows running along a shape's side. While you drag they follow the shape directly, and when you let go they find a fresh way round the shapes and meet each shape straight on. Arrows that move along with the shapes keep their route.
- **Shift-drag keeps a move straight.** Holding Shift while dragging a selected shape (or selection) now moves it only horizontally or vertically, as in Visio and PowerPoint, instead of deselecting it. Shift-click still adds a shape to the selection, or takes it out.

## [0.1.27] - 2026-11-13

### Added
- **Play in label order:** Animation ▸ **Play in label order** (also **From labels** on the Set play order bar) reads the step numbers at the start of your arrow labels — "1.", "2.", "4a.", "4b." — and plays the arrows in that order. Arrows with the same number and different letters (4a, 4b) play together; arrows without a number keep animating all the time. Flowcharts you import from Mermaid with numbered labels play in that order straight away.
- **Sub-step badges:** in Set play order, arrows that play together are shown as 4a, 4b, 4c… instead of all showing 4, and the Inspector says "Plays as step 4b of 7".

## [0.1.26] - 2026-11-13

### Added
- **Diagram from text remembers your last script:** the box opens with the last Mermaid text you inserted (or pasted onto the canvas), so you can tweak it and insert again. It's kept in this browser (and separately in the desktop app).
- **Arrange ▸ Route arrows around shapes** (also on the right-click menus): the selected arrows, or all arrows on the page, become elbow arrows that go round shapes instead of through them, and arrows meeting the same side of a shape spread out along it. The routes are saved as ordinary waypoints, so you can still drag the segment bars, and **Reset route** on an arrow goes back to the automatic route. One undo step.

### Changed
- **Moving an arrow's end gives it a fresh route.** Dragging the start or end of an arrow drops its old waypoints, so it no longer twists back through them. When you let go, an elbow arrow between two shapes finds its way round the shapes again, starting from the snap point you dropped it on.
- **Flowcharts from Mermaid are laid out more like Mermaid does:** a subgraph's `direction` is only used when none of its shapes link outside it (Mermaid's own rule), so a group of targets fed from one side stacks up and down instead of lining up behind each other; shapes are placed in the order they appear in the text (so the first one, like an End User, comes first); and the gaps between shapes grow to fit the arrows' labels. If your arrows are elbow arrows, they're also routed around shapes straight away.

## [0.1.25] - 2026-11-13

### Changed
- **Arrows that play one after another now all move at the same speed.** Before, every arrow got the same amount of time, so long arrows rushed and short ones crawled. Each step now lasts as long as its arrow needs, with the same short pause between steps, and the loop length is set from that whenever you change the order: more (or longer) arrows mean a longer loop. Moving shapes afterwards keeps the speeds even.
- **Arrows with heads at both ends play out and back.** Imported two-headed arrows (`<-->` in flowcharts, `<<->>` in sequence diagrams) get the round-trip highlight, and so does any two-headed arrow you put in a play order.

## [0.1.24] - 2026-11-12

### Added
- **Choose the order arrows play in:** Animation ▸ **Set play order…** (also on the right-click menu for arrows) puts a numbered badge on every arrow. Click arrows in the order they should play: 1, 2, 3… Shift-click an arrow to have it play at the same time as the previous one, and click a numbered arrow again to take it out (the numbers after it close up). **Clear** starts again; **Done** or Esc finishes. The arrows then play one step after another and the loop repeats; arrows left out keep animating all the time. Each click is one undo step, and the loop gets longer if it's too short for the number of steps.

## [0.1.23] - 2026-11-12

### Added
- **Three snap points on each side:** when you draw or drag an arrow onto a shape there are now three points to attach to on every side (in the middle, and halfway between the middle and each corner) instead of one, so several arrows can meet a side without piling up. On rounded shapes such as ellipses and diamonds the points sit on the outline. The nearest point always wins.

## [0.1.22] - 2026-11-12

### Added
- **Steer elbow arrows with waypoints:** a selected elbow arrow shows a small bar in the middle of each segment. Drag a bar to slide that segment sideways; the arrow keeps its right angles and stays attached. Dragging the first or last segment adds a short jog next to the shape, so even a simple L-shaped arrow can be routed round things. **Reset route** in the Inspector goes back to the automatic route.
- Double-click a waypoint on a straight or curved arrow to remove it.

### Changed
- Elbow arrows no longer show the faint mid-dots and loose bend points, which pulled their right angles out of shape; the segment bars replace them.

## [0.1.21] - 2026-11-12

### Added
- **⌘-drag to duplicate** (Ctrl-drag on Windows), as in Visio: hold ⌘ and drag a shape, arrow or selection to pull away a copy, leaving the original where it was. Alt/Option-drag still works too. One drag is one undo step.

### Fixed
- **Set as default style** on an arrow now also saves its corner radius and curve, so new arrows get them too. Copy style / Paste style carry them as well.

## [0.1.20] - 2026-11-12

### Added
- **Move arrow labels by dragging them:** press on an arrow's label and drag it out of the way; the arrow itself stays put. The label keeps its place relative to the arrow when you move the connected shapes. Drag it back close to the line and it snaps onto the line again. One drag is one undo step. The Label offset slider in the Inspector now reaches further (±200 px).
- **Set an arrow label's width:** a selected arrow's label shows a dashed box with a handle on each side. Drag a handle to make the label narrower or wider; the text wraps onto more lines and the box grows downwards to fit. The Inspector has a Label width slider and **Fit label to its text** to go back to a single line.

### Changed
- Files now use format version 10. Older files open as before, but files saved with this version need FlowSketch 0.1.20 or later.

## [0.1.19] - 2026-11-11

### Added
- **Messages play one after another:** in a sequence diagram the messages can now light up in order (message 1, then 2, then 3…) instead of all at once, so playback and exported GIFs and videos tell the story step by step. Imported sequence diagrams do this automatically. For any arrows, choose Animation ▸ Play messages in order (with arrows selected, or for every sequence-diagram message on the page) or right-click ▸ Play in order; Play arrows together switches back. The loop is lengthened if it's too short (about 1.2 seconds per message), and the Inspector shows which step an arrow is.

### Changed
- Files now use format version 9. Older files open as before, but files saved with this version need FlowSketch 0.1.19 or later.

### Fixed
- Sequence-diagram messages always flow the way their arrow points. Before, if the arrow tool was set to the round-trip highlight, messages lit up out and back again. Messages already in a diagram become one-way when you choose Animation ▸ Play messages in order.
- Mermaid labels keep text in angle brackets, such as `Bearer <Entra_Token>`; before, it was removed as if it were an HTML tag. Real formatting tags such as `<b>` are still removed.
- A Mermaid `rect rgb(…)` block in a sequence diagram is now a tinted background band in that colour, as in Mermaid, instead of a frame titled "rect · rgb(…)".

## [0.1.18] - 2026-11-11

### Added
- **Activation bars in sequence diagrams:** the narrow boxes on a lifeline that show when a participant is busy. Mermaid's `activate` / `deactivate` and the `A->>+B` / `B-->>-A` shorthands create them when you import, and the new **Activation** tool in the Sequence palette draws one: drag down a lifeline, or click for a short one. Overlapping bars stack slightly to the right, bars move with their participant, and dragging a bar's end makes it longer or shorter. Messages start and end at the edge of an active bar instead of the middle of the lifeline.

### Changed
- Files now use format version 8. Older files open as before, but files saved with this version need FlowSketch 0.1.18 or later.

## [0.1.17] - 2026-11-11

### Added
- **Draw sequence diagrams by hand:** the new Sequence button on the toolbar opens a palette of sequence tools. **Participant** and **Actor** add a box (or pill) with a dashed lifeline, lined up with the others at the same height. **Message** and **Reply** (dashed) are dragged from one lifeline to another and stay level; clicking a lifeline with Message, or using **Message to itself**, adds a loop back. **Note** adds a sticky note, and **Frame** drags out a see-through loop / alt / opt frame and lets you type its title. Lifelines grow when you add messages below them, and each new item is selected so you can type its text straight away. Each tool remembers its own style.

### Changed
- Messages and replies in sequence diagrams imported from Mermaid now have open arrowheads, the same as messages drawn with the sequence tools and the arrow tool. The Reply tool uses an open arrowhead too.

## [0.1.16] - 2026-11-11

### Added
- **Pages:** one file can now hold several diagrams, as tabs along the bottom. Click + (or Insert ▸ New page) to add a page, click a tab to switch, double-click to rename, and right-click a tab to duplicate, move or delete it. Each page keeps its own shapes and remembers where you were looking; icons, pictures and animation settings are shared. Exports (GIF, video, PNG, SVG, HTML player) export the current page.
- **Sequence diagrams:** paste or type a Mermaid `sequenceDiagram` (Insert ▸ Diagram from text, or straight onto the canvas). Participants and actors become boxes with dashed lifelines, messages become animated arrows (solid, dashed replies, async and "lost" messages, messages to itself), with `autonumber` numbering, notes as sticky notes, and loop / alt / else / opt / par / critical / break blocks as titled frames. Moving a participant moves its lifeline and messages with it, an arrow dropped on a lifeline attaches there at that height, and dragging the bottom of a lifeline makes it longer or shorter.

### Changed
- Files now use format version 7. Older files open as before (as a single page), but files saved with this version need FlowSketch 0.1.16 or later.

## [0.1.15] - 2026-11-11

### Added
- **Rounded elbows:** arrows and lines with Elbow routing have a Corner radius in the Inspector. 0 keeps sharp right-angle corners; larger values round each bend. The arrow tool remembers it for new arrows.

### Fixed
- **Curved arrows now curve.** Choosing Curved used to look the same as Straight until you moved the Curvature slider; now it gives a gentle curve straight away, and Curvature (also when setting the tool's default) adjusts it. Existing arrows that were "curved" but drawn straight are now shown as Straight, so they look exactly as before. New arrows are straight by default.

### Changed
- Files now use format version 6. Older files open as before, but files saved with this version need FlowSketch 0.1.15 or later.
- **A new shape or arrow is selected as soon as you draw it,** while the drawing tool stays active for the next one. The Inspector shows its properties straight away, and you can just start typing to label it.
- **Type to label:** with one shape, arrow, text, container or icon selected, typing starts its label (like pressing Enter and typing). One-letter tool shortcuts (R, A, T, …) work when nothing is selected: press Esc first. Esc from a drawing tool now also clears the selection, so one Esc is enough.

## [0.1.14] - 2026-11-11

### Changed
- **Safer input handling:** pasted or typed flowchart text is limited in size (500 shapes, 2,000 arrows, 20 levels of subgraphs, lines up to 2,000 characters), and hidden or direction-changing characters that can disguise text are removed from labels. Icon ZIPs that would unpack to more than 400 MB or 20,000 files are refused (protects against "zip bombs"). Saved preferences are checked when FlowSketch starts, so damaged settings fall back to defaults instead of causing problems.

### Added
- **Diagram from text:** Insert ▸ Diagram from text (Mermaid) turns a Mermaid flowchart into a laid-out, animated diagram: names become shapes (boxes, rounded boxes, pills, diamonds, circles, databases, hexagons, parallelograms), arrows become animated arrows with their labels, and subgraphs become containers. You can also paste flowchart text, even just `User --> GE --> MCP Server`, straight onto the canvas. Shapes and arrows use your default styles. Styling and click actions in the text are ignored.
- **Auto-layout:** Arrange ▸ Auto-layout (also in the right-click menus) arranges the selected shapes, or the whole diagram, left to right, top to bottom, right to left or bottom to top along their arrows. Each container's contents are arranged inside it and the container moves as one block. One undo puts everything back.

## [0.1.13] - 2026-11-03

### Changed
- The README's Mac app section now covers a first install from scratch, updating to a new version, and fixes for common problems (a refused `git pull`, `cargo` not found, an old version in About, the macOS first-launch warning, a failing build).

## [0.1.12] - 2026-11-03

### Added
- **Match size:** select the shape to copy the size from first, Shift-click the others, then choose Match size (right-click or Arrange) ▸ Width, Height or Both. Width and Height change only that side (turn on "keeps each shape's proportions" in Edit ▸ Preferences to scale the other side too); Both makes them exactly the same size. Shapes keep their centre; text, arrows, containers and locked items are left alone.

## [0.1.11] - 2026-11-03

### Added
- **FlowSketch as a Mac app:** FlowSketch can be built as `FlowSketch.app` that runs in its own window from Applications or the Dock, without a browser or Terminal. Save, Open and exports use the normal macOS dialogs, and Save writes back to the file you opened. See "Desktop app" in the README for the one-time setup.

## [0.1.10] - 2026-11-02

### Added
- **Next fill colour while drawing:** hold ⌘ (Ctrl on Windows) while drawing a shape and it gets the next colour along the palette row (Pale yellow → Pale green → Pale teal …, wrapping round). The shape tool remembers it, so the next shape of that kind starts from there. Shapes with white, grey, custom or no fill start at Pale red. Hold ⌘ while choosing Add container to do the same for containers.

## [0.1.9] - 2026-11-02

### Changed
- **Containers look simpler:** one outline with the title inside at the top-left, without the line under the title. New containers are square-cornered with a dashed border. Existing containers keep their colours and corners; change the corners with Corner radius in the Inspector.

## [0.1.8] - 2026-11-01

### Added
- **Quick-connect:** hover a shape and small arrows appear around it. Click one to add a copy of the shape on that side, already connected by an arrow, then press Enter to type its label. Rest the pointer on an arrow for a moment to pick a different shape instead (your recent picks come first). Drag one onto another shape to connect the two, or onto empty canvas to drop a connected copy there. With a shape selected, ⌘/Ctrl + arrow keys do the same. Works for shapes, icons and pictures; a copy of a shape in a container joins that container.

## [0.1.7] - 2026-11-01

### Added
- **Round-trip arrows:** with the travelling highlight, set Direction to ⇄ Round trip and the highlight travels to the end of the arrow and back again, in a different colour on the way back (blue out, pink back by default). It shows a request and its response on one arrow. Choose the return colour and how long it waits at the far end in the Inspector.

### Changed
- Files now use format version 5. Older files open as before, but files saved with this version need FlowSketch 0.1.7 or later.

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
