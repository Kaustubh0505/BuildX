# BuildX

BuildX is an Electron desktop workspace for implementation blueprints. The app shell and local project storage are implemented. The project management interface, Gemini generation, and exports are not implemented yet.

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

The renderer receives `window.buildx` with named `projects`, `generation`, and `exports` methods. Project methods now operate on versioned JSON files under Electron's `userData/projects` directory. Generation and export methods still return `NOT_AVAILABLE_YET`.
