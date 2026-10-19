# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. You can create and manage local projects, generate a nine-section blueprint with your Gemini API key, then edit and save each section. Markdown and PDF exports are planned for a later milestone.

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

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Projects are versioned JSON files under Electron's `userData/projects` directory. The Gemini API key is held only in memory for the current app session. Export methods currently return `NOT_AVAILABLE_YET`.
