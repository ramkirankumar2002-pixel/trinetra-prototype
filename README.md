# Trinetra Systems — Smart Weighbridge Prototype

A funding prototype of a smart weighbridge, built as **one website** with three role-based parts (weighbridge kiosk, supervisor, store officer), one backend, and an ESP32 weighbridge model. The core promise: **the backend owns the weight**, so nobody can fake it from the screen.

- Master plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Rules for Claude: [CLAUDE.md](CLAUDE.md)

**Current state:** Phase 9 (website foundation) and the new design. The three logins work in English and Hindi; the supervisor and store dashboards show sample data. A whole truck journey of every type runs through the API (`pnpm journey`). The real firmware (Phase 5B) and the truck screens are not built yet.

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
├─ scripts/           @trinetra/scripts: ESP32 and camera simulator, sample plate photos
├─ tests/e2e/         @trinetra/e2e: Playwright browser tests (logins; demo scenarios later)
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

Edit [apps/server/src/db/schema.ts](apps/server/src/db/schema.ts), run `pnpm db:generate`, check the new SQL file in `apps/server/drizzle/`, then run `pnpm db:migrate`. Never edit a migration that has already been applied. Two rules are hand-written SQL, in `0001_rules_and_append_only.sql`: trip ranges cannot overlap, and `ticket_events` rows cannot be updated or deleted. `0003_demo_reset_delete.sql` lets "Reset demo data" delete the rows of demo tickets only. After pulling new code, run `pnpm db:migrate`.

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

### Tickets

Request and answer types are in [packages/shared/src/tickets.ts](packages/shared/src/tickets.ts). **No request carries a weight:** the backend takes it from the weighbridge.

| Address                                                   | Who                          | What it does                                                                             |
| --------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/anpr`                                          | Kiosk                        | Reads both plates of the truck on the bridge; returns an open or recently blocked ticket |
| `POST /api/tickets`                                       | Kiosk                        | Starts a ticket, or resumes one younger than 10 minutes                                  |
| `GET /api/tickets/:id`                                    | Kiosk, its supervisor, store | The ticket with requests, photos and timeline                                            |
| `POST /api/tickets/:id/upload-link`                       | Kiosk                        | One-time invoice upload link (10 minutes)                                                |
| `GET` and `POST /api/upload/:code`                        | Whoever has the code         | The driver's phone: plate and language; then the file (JPEG, PNG, WebP or PDF, 8 MB)     |
| `PATCH /api/tickets/:id/details`                          | Kiosk                        | Material, supplier, transporter, driver; mismatch check                                  |
| `POST /api/tickets/:id/first-weight` and `/second-weight` | Kiosk                        | Captures the stable weight                                                               |
| `POST /api/tickets/:id/discard-weight` and `/printed`     | Kiosk                        | "Weigh again" before confirming; logs the Print button                                   |
| `GET /api/supervisor/tickets?status=`                     | Supervisor                   | Their Type 1 trucks (`pending` or `done`)                                                |
| `POST /api/supervisor/tickets/:id/photo`                  | Its supervisor               | Live JPEG with optional `lat`, `lng`, `accuracyM` form fields; plate match (3 photos)    |
| `POST /api/approvals/:id/decide`                          | Supervisor, store            | `APPROVE` or `REJECT`; a decision cannot be changed                                      |
| `GET /api/store/requests?status=`                         | Store                        | Requests (`pending` or `done`), newest first, and warnings of the last 24 hours          |
| `POST /api/help`                                          | Kiosk                        | Calls the store officer                                                                  |
| `GET /api/public/tickets/:ticketNo`                       | Anyone                       | Read-only timeline without phone numbers                                                 |
| `GET /api/live/summary`                                   | Anyone                       | Counts for the projector screen                                                          |
| `/api/demo/settings`, `/weight`, `/reset`                 | Kiosk + admin PIN            | Demo switches, simulated weight, delete demo tickets                                     |

A job abandons STARTED tickets with no activity for 10 minutes. The lights, buzzer and display follow the ticket by themselves.

**Idempotency-Key:** any logged-in `POST`, `PATCH` or `PUT` may send this header. A repeat of a successful request gets the first answer again and nothing is done twice (kept in memory for 12 hours).

**Demo routes:** set `ADMIN_PIN` (6 to 12 digits) in `apps/server/.env` and restart the backend; send it in an `x-admin-pin` header. `GET` and `PUT /api/demo/settings`, `POST /api/demo/weight` and `POST /api/demo/reset`. Tickets made while a demo switch is on are tagged demo, and only those are deleted by a reset.

## Journeys

`pnpm journey` runs five full truck journeys through the HTTP API: Type 3 automatic, Type 1 approved by the supervisor, fraud blocked, Type 2 approved by the store, and a tolerance fail resolved by the store. Weights come from the simulator, and plates and invoices from the demo "pick" modes, so no camera or outside service is used. It needs `DEVICE_TOKEN` and `ADMIN_PIN`, and a migrated and seeded database. **It runs "Reset demo data" first.** It uses a backend already running on port 4000, or starts its own.

```powershell
pnpm journey
```

To leave a running `pnpm dev` alone, give the journey its own port first:

```powershell
$env:JOURNEY_SERVER_URL = "http://localhost:4100"
```

Five wrong PINs lock a username for 1 minute. The lock is kept in memory, so restarting the server clears it. Logging out removes the cookie from that browser; the server keeps no list of sessions.

To log in from PowerShell, with `pnpm dev` running (`ram` is the store officer):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login -ContentType "application/json" -Body '{"username":"ram","pin":"2001"}' -SessionVariable trinetra
```

```powershell
Invoke-RestMethod -Uri http://localhost:4000/api/auth/me -WebSession $trinetra
```

To try the role guard, start the server with `NODE_ENV=test`. That adds `/api/test/kiosk`, `/api/test/supervisor` and `/api/test/store`, which do not exist otherwise.

## Simulator

The simulator acts as the whole weighbridge: the main ESP32 **and** both cameras. It needs the three device tokens in `apps/server/.env` (see [Device tokens](#device-tokens)).

Start the backend (or `pnpm dev`), then in a second terminal:

```powershell
pnpm sim
```

| Key | What happens                                                           |
| --- | ---------------------------------------------------------------------- |
| `a` | A truck arrives: the weight climbs, wobbles, then settles at 32,560 kg |
| `e` | An empty truck arrives and settles at 18,250 kg                        |
| `l` | The truck leaves: back to 0                                            |
| `p` | Switches "position OK" off or on                                       |
| `u` | Switches an unstable wobble on or off                                  |
| `o` | All three boards go offline for 5 seconds                              |
| `m` | Switches between the matching and the mismatched plate photos          |
| `h` | Shows the keys                                                         |
| `q` | Quits                                                                  |

It prints every command it receives (light, buzzer, display, tare). On "snap", each camera uploads a sample photo from [scripts/sample-plates](scripts/sample-plates): `match-*.jpg` show MH 12 AB 1234 front and back; `mismatch-back.jpg` shows MH 14 CD 5678. `pnpm sim:plates` draws them again. These are drawings for testing the connection, not for judging plate reading.

To start with the mismatched pair, or to use a backend on another address:

```powershell
pnpm -C scripts sim --mismatch --url ws://localhost:4000/device
```

### Watching the weight

`GET /api/kiosk/state` (kiosk login) shows the live weight, which boards are online and whether a weight may be captured. With `pnpm dev` running:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login -ContentType "application/json" -Body '{"username":"wb01","pin":"3001"}' -SessionVariable kiosk
```

```powershell
Invoke-RestMethod -Uri http://localhost:4000/api/kiosk/state -WebSession $kiosk | ConvertTo-Json -Depth 4
```

With `NODE_ENV=test` the backend also has `POST /api/test/photos` (asks both cameras for photos) and `POST /api/test/command` (for example `{"t":"light","c":"green"}`), both for the kiosk login.

## Device connection

The firmware (Phase 5B) and the simulator speak this protocol.

- **WebSocket** `/device` (`wss://` when deployed), with the board's secret in an `x-device-token` header. A wrong or missing token is closed at once (code 1008). A new connection replaces the board's old one (code 4000). Messages are at most 4 KB of JSON; bad ones are ignored and logged.
- **Main ESP32 sends** `{"t":"w","kg":32560,"stable":true,"pos":true}` about every 200 ms, and `{"t":"hb"}` every 5 s. It is **offline after 3 s** without a message.
- **Main ESP32 receives** `{"t":"light","c":"green"|"red"|"orange"}`, `{"t":"buzz","ms":1000}`, `{"t":"display","text":"Go to CH-6"}` (1 to 80 characters) and `{"t":"tare"}`. Tare is only sent when the bridge is empty.
- **Cameras send** `{"t":"hello","cam":"front"}` (or `"back"`) after connecting, then `{"t":"hb"}` every 5 s. A camera is **offline after 15 s** without a message. A hello that does not match the token is refused.
- **Cameras receive** `{"t":"snap","id":"<photo-id>"}` and upload with `POST /api/device/photo/<photo-id>`: header `x-device-token`, header `content-type: image/jpeg`, the JPEG itself as the body (not a form), at most 8 MB. Success is `201`. A photo id works once and only for the camera it was sent to. If nothing arrives in 5 s, the same id is sent once more.

### When a weight can be captured

`canCapture` is true only when all of these hold. Otherwise its reason is the first that fails:

| Reason                | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `SETTINGS_NOT_LOADED` | The backend has not read the weighbridge settings from the database |
| `DEVICE_OFFLINE`      | The main ESP32 is offline                                           |
| `STALE_READING`       | The newest weight is 1 second old or more                           |
| `NO_TRUCK`            | The weight is not above the wake threshold                          |
| `POSITION_NOT_OK`     | The truck is not fully on the bridge                                |
| `NOT_STABLE`          | The weight has not held still for 3 seconds with the stable flag on |

### Device tokens

Put a different random value (at least 16 characters) in each of `DEVICE_TOKEN`, `CAM_FRONT_TOKEN` and `CAM_BACK_TOKEN` in `apps/server/.env`. A board with no token cannot connect. This prints one value:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## Website

With `pnpm dev` running (and the database seeded):

| Page                               | Log in with                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| <http://localhost:3000/kiosk>      | The kiosk user (landscape, 1366×768 or 1920×1080)                                                                   |
| <http://localhost:3000/supervisor> | A supervisor (made for a phone)                                                                                     |
| <http://localhost:3000/store>      | The store officer (made for a phone)                                                                                |
| <http://localhost:3000/dev/ui>     | No login: the design system; `?kiosk=details` and others show sample weighbridge screens (not in production builds) |

Demo usernames and PINs are in [default-data.ts](packages/shared/src/seed/default-data.ts), and `pnpm db:seed` prints them. One browser holds one login: logging in to another part replaces it. To be logged in to two at once, use two browser profiles or a private window.

- **API calls** go to `/api/*` on the website itself, and Next forwards them to `BACKEND_URL` (default `http://localhost:4000`), so the login cookie belongs to the website. Restart `pnpm dev` after changing it. **Live events** connect straight to `NEXT_PUBLIC_SOCKET_URL`.
- **Website code** calls the backend only through `api` in `apps/web/src/lib/api.ts`. Errors are `ApiError` with a `code`; an ended login opens the right login page; every POST, PATCH and PUT carries an `Idempotency-Key`.
- **Design:** every screen follows the [style guide](docs/design/STYLE_GUIDE.md). Pictures: [docs/screenshots/ui-update](docs/screenshots/ui-update).
- **Screen text** is in `apps/web/src/i18n/en.json` and `hi.json`, read with `useT()`. Add every key to both. The Hindi text has not been reviewed yet.

### Browser tests

Playwright logs in as each role with its demo PIN, checks the page, the language switch and the connection status, tries the other roles' pages and logs out. It also measures the kiosk's driver rules, and checks the dashboards at phone, tablet and desktop width. It uses the installed **Google Chrome** and the development database, and uses a running `pnpm dev` or starts one.

```powershell
pnpm test:e2e
```

## Live events

The backend pushes news to the browsers with **Socket.IO** on the same port as the API (4000). Browsers only listen.

- A page first calls `GET /api/auth/socket-token` with its login cookie, then connects with that token, which lasts 60 seconds. A new one is fetched for every reconnection. A missing, wrong or expired token is refused. The connection ends when the login expires.
- The **backend** puts each connection in its room: kiosk, `supervisor:<userId>` or store. A browser cannot choose.
- The **live** room (for the projector screen) needs no login: connect with `{ live: true }`. It is read-only.
- Only the website at `FRONTEND_ORIGIN` may connect from a browser.

| Event                         | Sent to                        | Carries                                                             |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `hw:weight`                   | kiosk                          | kg, stable, positionOk, canCapture, reason, at (at most 5 a second) |
| `hw:status`                   | kiosk, live                    | main, front, back online; also sent to each screen as it connects   |
| `truck:arrived`, `truck:left` | kiosk                          | kg, at                                                              |
| `ticket:updated`              | kiosk, supervisor, store, live | ticketId, status                                                    |
| `approval:new`                | supervisor, store              | approvalId, ticketId, kind                                          |
| `approval:decided`            | kiosk, supervisor, store       | the same, and status                                                |
| `kiosk:ready`                 | kiosk                          | ticketId, ticketNo, plate                                           |
| `invoice:read`                | kiosk                          | ticketId                                                            |

The names and types are in [packages/shared/src/realtime.ts](packages/shared/src/realtime.ts).

**Backend code** sends news about saved data only after the save:

```ts
await app.eventTransaction(async (tx) => {
  // ...database changes using tx...
  emitAfterCommit("ticket:updated", ["kiosk", "store"], { ticketId, status });
});
```

If the transaction rolls back, nothing is sent. **Website code** uses `useSocketEvent(name, handler)` and `useOnReconnect(reload)` from `apps/web/src/lib/socket-hooks.ts`.

### Try it: /dev/live

A development-only test page (a 404 in production builds).

1. Start the website and backend (skip this if `pnpm dev` is already running):

   ```powershell
   pnpm dev
   ```

2. In a second terminal, start the simulator:

   ```powershell
   pnpm sim
   ```

3. Open <http://localhost:3000/dev/live>. Use `localhost`, not `127.0.0.1` or the computer's IP address: the backend allows only the website address in `FRONTEND_ORIGIN`.
4. Log in as `wb01` with the kiosk demo PIN (printed by `pnpm db:seed`).

## Plate and invoice reading

The backend reads number plates with **Plate Recognizer** (region India) and asks **Gemini** about the same photo if no plate is found or the service fails. **Gemini** reads invoices (photo or PDF). Put `PLATE_RECOGNIZER_TOKEN` and `GEMINI_API_KEY` in `apps/server/.env`.

- `GEMINI_MODEL` chooses the main model (default `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODEL` the backup (default `gemini-3.5-flash-lite`). If the main model is busy, rate limited or does not answer within 30 s, the backup is asked **once**. The result (`model`) and the log say which one answered. To switch the backup off, give both the same name; the main model is then retried when busy. A wrong key, a refused request or an unreadable answer does not go to the backup. Restart the backend after changing either.
- Gemini is called with storage turned off. On the free tier, still use **sample invoices only**.
- Plate Recognizer's free plan allows 2,500 lookups a month and **1 a second**, so the two photos of a truck are read about a second apart.
- Calls are counted per day in the `settings` table (`api_usage:...`), with a warning in the log near the limits. The services' own dashboards are the truth.
- Anything unreadable comes back empty. Photos are turned upright, shrunk to 1600 px wide, saved as JPEG and stripped of hidden details such as GPS.

### Try it: /dev/readers

With `pnpm dev` running, open <http://localhost:3000/dev/readers> and log in as the kiosk. Upload a photo to read a plate, or a photo or PDF to read an invoice. **Each read uses your free quota.** Nothing is saved. The page and its routes do not exist in production.

### Demo mode ("pick")

If a service fails on stage, these settings replace it. They are in [default-data.ts](packages/shared/src/seed/default-data.ts); edit them and run `pnpm db:seed` (a settings page comes in Phase 14). Running `pnpm db:seed` also puts them back to whatever the file says.

| Setting     | Values         | Effect of `pick`                                                                                |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `anpr_mode` | `real`, `pick` | Uses `demo_plate` (from the vehicle list) instead of the cameras                                |
| `ocr_mode`  | `real`, `pick` | Uses the sample invoice named by `demo_invoice`: `cement`, `steel-scrap`, `sand` or `aggregate` |

### Sample invoices and the real check

[scripts/sample-invoices](scripts/sample-invoices) holds four made-up **SAMPLE** invoices as PDF and JPEG, one per demo scenario (`pnpm sim:invoices` draws them). [scripts/test-plates](scripts/test-plates) holds 10 synthetic plate images (`pnpm sim:test-plates`). They are **not** a test of real camera photos.

This reads them all with the **real services** (about 10 plate lookups and 4 Gemini requests):

```powershell
pnpm check:readers
```

For your own photos, put them in `scripts/test-photos/` (never committed), name each after its plate such as `MH12AB1234-1.jpg`, and run:

```powershell
pnpm check:readers --plates-only --folder scripts/test-photos
```

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
| `pnpm test:e2e`        | Runs the browser tests (see [Browser tests](#browser-tests))                    |
| `pnpm screenshots`     | Takes the pictures in `docs/screenshots` again                                  |
| `pnpm sim`             | Simulates the main ESP32 and both cameras (see [Simulator](#simulator))         |
| `pnpm journey`         | Runs the five truck journeys (see [Journeys](#journeys))                        |
| `pnpm sim:plates`      | Draws the sample plate photos again                                             |
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
