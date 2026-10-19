# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. You can create, open, rename, and delete local projects, and save each project's brief. Gemini generation and exports are not implemented yet.

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

Run the desktop project-workspace test with:

```sh
npm run test:workspace
```

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Projects are versioned JSON files under Electron's `userData/projects` directory. Generation and export methods still return `NOT_AVAILABLE_YET`.
