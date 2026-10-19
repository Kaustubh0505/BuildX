# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. You can create and manage local projects, generate a nine-section blueprint with your Gemini API key, edit and save each section, and export the saved blueprint as Markdown or A4 PDF.

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

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Projects are versioned JSON files under Electron's `userData/projects` directory. The Gemini API key is held only in memory for the current app session. Exports use Electron's native save dialog and the saved blueprint sections.
