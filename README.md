# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. Milestone 1 contains the application shell and a restricted preload API. Project management, Gemini generation, and exports are not implemented yet.

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

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Every method currently returns `{ ok: false, code: 'NOT_AVAILABLE_YET', message: 'This feature is not available yet.' }`.
