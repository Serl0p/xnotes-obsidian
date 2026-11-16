# xNotes Appearance Viewer (unofficial fork)

Based on [Erik Vaněk’s xNotes Viewer](https://github.com/NeDDy3z/xnotes-obsidian), Apache-2.0. Read-only desktop and mobile viewer for .xnote/.xnotes files. Version 0.3.0 integrates upstream 0.1.10 with the appearance fork's controls, bounded neon buffers, local audio playback, and partial embedded JSON template support.

## Install

Build with `npm ci && npm run build` or use the files from a successful GitHub release. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/xnotes-appearance-viewer/`. Disable the original viewer before enabling this fork. The ID is unchanged from Appearance Viewer 0.2.0. Keep your existing data.json to retain settings.

## Features and limits

- Auto, Original, Light, Dark modes; individual paper, template and contrast toggles.
- Neon Auto (simple on mobile), Simplified and Full glow; bounded temporary canvases preserve upstream cut clipping.
- Local audio controls and page markers; no stroke synchronization yet.
- Partial embedded plain JSON .xtemplate geometry; images, packaged templates and precise advanced compositing are not supported. PDF pixels are not recolored.
- Upstream Insert Space, pen geometry, cut strokes, image rotation and rich-text handling retained. Long-note lazy rendering remains future work.

The source is the maintained implementation. The checked-in upstream main.js is not the 0.3.0 build until regenerated; use CI/release artifacts rather than the stale file. Android testing is required before treating 0.3.0 as stable. Original notes are never modified. No private note fixtures are committed.

Apache-2.0; bundled fflate is MIT. Original attribution retained.
