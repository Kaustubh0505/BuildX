# BuildX API

This service owns accounts, sessions, and cloud projects. Run it separately from Electron. Only the API server receives database credentials.

## Local setup

Requires Node.js 22+, npm, and either Docker or a local MongoDB installation.

From the repository root:

```sh
npm run server:install
docker compose up -d mongo
cp server/.env.example server/.env
npm run server:start
```

The development database is bound to `127.0.0.1:27017` and persists in the `buildx-mongo` Docker volume. It is for local development only. If MongoDB already runs locally on that port, use it instead of starting Docker.

In a second terminal:

```sh
npm install
npm run dev
```

The desktop API address defaults to `http://127.0.0.1:3001` in `buildx.config.json`. Override it for development with `BUILDX_API_URL`. The app must be online to open and save projects. Open drafts stay in memory after a failed request; Retry repeats the operation. Project conflicts require an explicit reload with discard confirmation.

## MongoDB Atlas and production configuration

1. Create an Atlas cluster and a database user limited to the BuildX database. Allow connections from the API host's outbound IP address.
2. Set the API host's `MONGODB_URI` to the Atlas connection string and `MONGODB_DATABASE` to the database name. Keep credentials in the host's secret environment, outside source control and the desktop package.
3. Run `npm ci --prefix server` and `npm run server:start` from a checkout containing both `server/` and `electron/project-store.cjs` (the latter supplies the shared section names). Configure `HOST=0.0.0.0` if your hosting environment requires it.
4. Put the API behind HTTPS. Set `TRUST_PROXY_HOPS` only to the exact number of trusted reverse proxies in your deployment; otherwise leave it unset so clients cannot spoof the IP used for throttling.
5. Set the public HTTPS API origin in `buildx.config.json` before `npm run package:mac`. This origin is public configuration, never a MongoDB URI. `BUILDX_API_URL` can override it when launching from a shell. Redirects, embedded credentials, and URL paths are rejected.

No hosted endpoint or Atlas account is provisioned by this repository. The packaged development app uses the local API until its public origin is configured.

## API contract

All responses use `{ ok: true, ... }` or `{ ok: false, code, message, fields? }`. Database and internal errors are sanitized. Requests are limited to 2 MB. Authentication and project responses are marked `Cache-Control: no-store`.

| Endpoint | Body / result |
| --- | --- |
| `POST /api/auth/signup` | `{ name, email, password }`; returns sanitized `user`, then the client signs in separately |
| `POST /api/auth/login` | `{ email, password }`; returns sanitized `user`, opaque `token`, and `expiresAt` to Electron main only |
| `GET /api/auth/me` | Returns sanitized `user` |
| `POST /api/auth/logout` | Revokes the current session |
| `GET /api/projects` | Returns summaries sorted by recent update |
| `POST /api/projects` | Optional intake fields; returns new `project` |
| `GET /api/projects/:id` | Returns owned `project` |
| `PATCH /api/projects/:id/input` | `{ title, problem, desiredFeatures, constraints, version }` |
| `PATCH /api/projects/:id/title` | `{ title, version }` |
| `PUT /api/projects/:id/blueprint` | `{ sections, version }`; server assigns `generatedAt` |
| `PATCH /api/projects/:id/sections/:section` | `{ content, version }` |
| `DELETE /api/projects/:id` | `{ version }` |
| `POST /api/projects/import` | A validated schema-version-1 local project; returns `{ imported, project }` without overwriting existing data |

Protected endpoints require `Authorization: Bearer <token>`. Email is trimmed, lowercased, and uniquely indexed. Passwords are required and retain whitespace, with no password length or character rules. New passwords use a domain-separated SHA-256 digest encoded as Base64 before bcrypt cost 12, so bcrypt never truncates long passwords. The general 2 MB request limit still applies. Existing direct-bcrypt accounts are upgraded on successful login. Signup and login accept only their defined fields. Login errors do not distinguish unknown emails from wrong passwords.

Session tokens contain 32 cryptographically random bytes. MongoDB stores only SHA-256 token hashes. Sessions expire after exactly seven days and are checked on every request; TTL indexes only clean up expired records. Logout revokes the current token. Other device sessions remain active.

Authentication limits use shared MongoDB counters: 10 signup attempts per IP per hour, 60 login attempts per IP per 15 minutes, and 10 login attempts per normalized email per 15 minutes. These are fixed windows. Password reset, email verification, and MFA are outside this release.

Every cloud project has a server-controlled owner and a `version` starting at 1. Updates atomically match both ownership and the expected version, incrementing the version once. Stale writes/deletes return `409 CONFLICT`. Requests for another account's project return `404 NOT_FOUND`. The server never accepts ownership from the client. Automatic migration deduplicates by account and original project ID and never deletes local files. Electron assigns legacy projects to the first signed-in account and records successful migrations in user data. Later accounts do not receive those projects, and refreshing the sidebar does not restore deleted projects.

## Desktop security and session behavior

React receives only named preload methods. Tokens are held in the main process; saved tokens are encrypted with Electron `safeStorage` and written atomically with restrictive file permissions. If secure storage is unavailable, sign-in lasts for the running app session, with a visible explanation. Passwords are cleared from the form after success and never saved in projects or exports. Gemini keys stay in main-process memory and are cleared on logout or session expiry.

Startup validates saved sessions through `/me`. Connection failures offer retry without discarding the encrypted token. Session expiry hides the workspace and retains drafts in memory for the same account to sign in again. Changing accounts or logging out prompts before discarding unsaved drafts. No project cache or offline write queue is created.

## Verification

```sh
npm run test:api
npm run test:cloud
npm run test:auth-ui
npm run test:workspace
npm run test:export-ui
npm run test:smoke
npm run package:mac
npm run test:package
```

Integration tests start `mongod` in a temporary directory and use a unique test database. Install `mongod` or set `MONGOD_BINARY`. Alternatively set `MONGODB_TEST_URI` to a disposable MongoDB server where the test user can create/drop test databases. Tests do not use the production `MONGODB_URI` and never access the normal BuildX account or project directory. Electron tests use real API requests and isolated user-data directories.

## Connection troubleshooting

The desktop app connects to the API, and the API connects to MongoDB. Keep `npm run server:start` running while using the local app. Startup now reports separate DNS, authentication, and Atlas network-access failures without printing credentials.

If a database password contains characters such as `@`, `#`, `/`, `?`, or `:`, percent-encode those characters in the URI credential fields (for example, `@` becomes `%40`). Use an Atlas **Database Access** user, not the Atlas website login. An authentication rejection requires correcting that database user's credentials; an IP allowlist failure requires updating Atlas **Network Access**.

Use the exact existing database name, including letter casing, for `MONGODB_DATABASE`. MongoDB rejects creating a second database whose name differs from an existing one only by uppercase/lowercase letters.
