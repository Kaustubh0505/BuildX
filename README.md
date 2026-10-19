# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. You can create and manage local projects, generate a nine-section blueprint with your Gemini API key, edit and save each section, and export the saved blueprint as Markdown or A4 PDF. Blueprint sections open in a formatted editor with headings, emphasis, lists, code, and tables. Switch to Markdown when you want to edit the source directly. The Data entities section also shows a live entity-card view based on its headings and fields.

## Run locally

Requires Node.js 22 or newer and macOS.

```sh
npm install
npm run dev
```

To launch the built renderer without Vite:

```sh
npm start
```

Build a locally runnable Apple Silicon `.app` with electron-builder:

```sh
npm run package:mac
open release/mac-arm64/BuildX.app
```

The app is ad hoc signed for local use. It is not notarized for distribution.

Run the Electron smoke test with:

```sh
npm run test:smoke
```

Run the project storage tests with:

```sh
npm run test:store
```

Run the generation tests with:

```sh
npm run test:generation
```

Run the desktop project-workspace test with:

```sh
npm run test:workspace
```

Run the export tests with:

```sh
npm run test:exports
npm run test:export-ui
```

After packaging, run `npm run test:package` to open the `.app` with disposable project data and verify storage, PDF export, and the preload boundary.

To make one live Gemini request, set `GEMINI_API_KEY` in your shell and run `npm run test:live-gemini`. The test uses a temporary project and removes it afterward. The key is not printed or written to the project file.

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Projects are versioned JSON files under Electron's `userData/projects` directory. The Gemini API key is held only in memory for the current app session. Exports use Electron's native save dialog and the saved blueprint sections.
