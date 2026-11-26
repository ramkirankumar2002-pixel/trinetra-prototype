# Trinetra Systems — Smart Weighbridge Prototype

A funding prototype of a smart weighbridge, built as **one website** with three role-based parts (weighbridge kiosk, supervisor, store officer), one backend, and an ESP32 weighbridge model. The core promise: **the backend owns the weight**, so nobody can fake it from the screen.

- Master plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Rules for Claude: [CLAUDE.md](CLAUDE.md)

**Current state:** Phase 4 (business rules). The rules are written and tested in `packages/shared`, but no screen or API uses them yet. The website shows a simple home page. The backend has login with roles, a health check and file storage, on top of the database. No weighbridge features yet.

## Folder layout

```
trinetra-prototype/
├─ apps/
│  ├─ web/            @trinetra/web: Next.js website
│  └─ server/         @trinetra/server: Fastify backend
├─ packages/
│  └─ shared/         @trinetra/shared: TypeScript used by both apps
├─ firmware/
│  ├─ esp32/          Weighbridge model code (from Phase 5)
│  └─ esp32-cam/      Front and back camera code (from Phase 5)
├─ scripts/           ESP32 simulator and demo helpers (from Phase 5)
├─ tests/e2e/         Playwright demo scenarios (added in a later phase)
└─ docs/              Build plan, progress and decisions
```

## Requirements

- **Node.js 22 LTS** (22.18 or newer). `.nvmrc` contains the version.
- **pnpm 10.** The exact version is in `package.json` (`packageManager`). Install it with Corepack or npm:

  ```powershell
  npm install -g pnpm@10
  ```

- **PostgreSQL 16** on port 5433 (see [Database](#database)). Docker is not required.

## Install and run

Install the packages (from the repository root):

```powershell
pnpm install
```

Start the website and the backend together:

```powershell
pnpm dev
```

- Website: <http://localhost:3000>
- Backend health check: <http://localhost:4000/api/health>

Press `Ctrl+C` to stop both.

## Database

The backend uses **PostgreSQL 16**. Development expects it at `localhost:5433`, with user `postgres` and password `postgres` (local development only).

### 1. Install PostgreSQL 16

Install it directly on Windows with the [PostgreSQL installer](https://www.postgresql.org/download/windows/). During setup, use the password `postgres` and the port `5433`.

Port 5433 is used because another PostgreSQL version may already be on the usual port, 5432. These settings never connect to 5432. If your server uses a different port or password, change both addresses in `apps/server/.env`.

**Docker instead (optional):** `docker compose up -d` starts PostgreSQL 16 on the same port using `docker-compose.yml`. Do not run it while another server is using port 5433. This file has not been tested yet, because Docker is not installed on the development machine.

### 2. Create the settings file

```powershell
if (-not (Test-Path apps/server/.env)) { Copy-Item apps/server/.env.example apps/server/.env }
```

Then set `JWT_SECRET`: **the server will not start without it.** This prints a random value to paste after `JWT_SECRET=`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The copied file already has working local values for the other required settings, including:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/trinetra
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/trinetra_test
```

### 3. Create the databases

This creates `trinetra` and `trinetra_test` if they are missing:

```powershell
pnpm db:create
```

### 4. Create the tables

```powershell
pnpm db:migrate
```

### 5. Load the demo data

```powershell
pnpm db:seed
```

It is safe to run again, and it prints the demo PINs at the end. All master data lives in [packages/shared/src/seed/default-data.ts](packages/shared/src/seed/default-data.ts): edit that file, then run the seed again. Running it again adds and updates rows, and replaces all unloading rules. It does **not** delete other rows you removed from the file; for that, reset.

To empty **every table, including all tickets and their timelines**, and load the data again:

```powershell
pnpm db:seed --reset
```

### 6. Look at the data

```powershell
pnpm db:studio
```

Then open <https://local.drizzle.studio>. The page talks to the Studio server running on your computer. Press `Ctrl+C` to stop it.

### Changing the tables

Edit [apps/server/src/db/schema.ts](apps/server/src/db/schema.ts), run `pnpm db:generate`, check the new SQL file in `apps/server/drizzle/`, then run `pnpm db:migrate`. Never edit a migration that has already been applied. Two rules are hand-written SQL, in `0001_rules_and_append_only.sql`: trip ranges cannot overlap, and `ticket_events` rows cannot be updated or deleted.

### Database tests

`pnpm test` **wipes the database in `TEST_DATABASE_URL`** and rebuilds it from the migrations. Its name must end in `_test`. If `TEST_DATABASE_URL` is not set, the database tests are skipped, so check the test summary.

## Backend API (so far)

| Address                      | Who         | What it does                                                                                           |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/health`            | Anyone      | `200` when the server and database are up; `503` with `"status": "degraded"` when the database is down |
| `POST /api/auth/login`       | Anyone      | `{ "username", "pin" }` sets the login cookie, valid 12 hours                                          |
| `POST /api/auth/logout`      | Anyone      | Clears the cookie                                                                                      |
| `GET /api/auth/me`           | Logged in   | The logged-in user                                                                                     |
| `GET /api/auth/socket-token` | Logged in   | A 60 second token for live updates (used from Phase 6)                                                 |
| `GET /api/files/...`         | Signed link | A stored file (local storage only)                                                                     |

Every error looks like `{ "error": { "code": "...", "message": "..." } }`, some with `details`.

Five wrong PINs lock a username for 1 minute. The lock is kept in memory, so restarting the server clears it. Logging out removes the cookie from that browser; the server keeps no list of sessions.

To log in from PowerShell, with `pnpm dev` running (`ram` is the store officer):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login -ContentType "application/json" -Body '{"username":"ram","pin":"2001"}' -SessionVariable trinetra
```

```powershell
Invoke-RestMethod -Uri http://localhost:4000/api/auth/me -WebSession $trinetra
```

To try the role guard, start the server with `NODE_ENV=test`. That adds `/api/test/kiosk`, `/api/test/supervisor` and `/api/test/store`, which do not exist otherwise.

## Environment files

The backend checks its settings when it starts and lists anything missing or wrong. It requires `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` and `STORAGE_DRIVER`; `STORAGE_DRIVER=supabase` also needs the three Supabase settings. `PORT` defaults to 4000 and `TZ` to Asia/Kolkata. The files are:

| Copy this                  | To this               |
| -------------------------- | --------------------- |
| `apps/server/.env.example` | `apps/server/.env`    |
| `apps/web/.env.example`    | `apps/web/.env.local` |

Each variable has a comment saying which phase uses it. Never commit the filled-in files, or `secrets.h` in the firmware folders.

## Commands

Run all commands from the repository root.

| Command                | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`             | Runs the website (:3000) and the backend (:4000) together, reloading on changes |
| `pnpm build`           | Builds the website and the backend for production                               |
| `pnpm test`            | Runs the tests (Vitest)                                                         |
| `pnpm test:coverage`   | Tests `packages/shared` and reports coverage; fails below the limits            |
| `pnpm lint`            | Checks the code with ESLint                                                     |
| `pnpm typecheck`       | Checks TypeScript types in every package                                        |
| `pnpm format`          | Formats files with Prettier (`docs/` and `CLAUDE.md` are left as written)       |
| `pnpm format:check`    | Checks formatting without changing files                                        |
| `pnpm db:create`       | Creates the two databases if they are missing                                   |
| `pnpm db:generate`     | Writes a new migration after a schema change                                    |
| `pnpm db:migrate`      | Creates or updates database tables                                              |
| `pnpm db:seed`         | Loads or updates the demo data                                                  |
| `pnpm db:seed --reset` | Deletes all data, then loads the demo data                                      |
| `pnpm db:studio`       | Starts Drizzle Studio to look at the data                                       |

Before each commit, run `pnpm typecheck`, `pnpm lint` and `pnpm test`.

After `pnpm build`, the production versions start with `pnpm --filter @trinetra/web start` and `pnpm --filter @trinetra/server start`.
