# Outreach Personalizer: developer documentation

Last updated 25 October 2026. This file is the single source of truth for what the product does, how it is built and
how to run and test it. Keep it in sync with the code.

Contents

1. What it does
2. How the product got here (owner decisions that changed the original brief)
3. Tech stack, versions and why
4. Architecture and request flows
5. Chrome and Brave behaviour, permissions
6. Data model
7. Sheets of 200 and automatic downloads
8. Drafting a sheet (the AI layer)
9. Auth
10. Security, privacy and fault isolation
11. Every file
12. Setup
13. Testing and the manual QA checklist
14. Defaults
15. Known limits

## 1. What it does

A Chrome (Manifest V3) extension with a side panel, plus a small API. It does three things:

1. **Collects email addresses** from web pages. With automatic collection on, every page the user opens is scanned.
   With it off, a click on the toolbar icon (or the right click item "Collect emails on this page", or Alt+Shift+O)
   collects the current page. Only addresses are kept, with the page's address and title. No names, no page text.
2. **Saves them into spreadsheets of 200.** Every address takes the next row of the current sheet. When a sheet reaches
   200 the extension saves it by itself as `Downloads/Outreach Personalizer/sheet-001.xlsx` (then 002, and so on) and
   starts the next. A sheet is also saved early if its oldest address is about to be deleted (3 hour retention), and the
   user can download any sheet at any time.
3. **Optionally drafts one message for a sheet.** The user types what they want to say, picks a tone and a length and
   clicks Draft. The AI writes one message (only the email address is known about each recipient, so the same message
   suits all of them, beginning "Hi there,") and it fills the sheet's Draft subject and Draft body columns. One AI call
   per sheet.

The extension never sends email, never guesses or verifies addresses, never reads hidden content, never runs on the
sites listed in section 10, and the user can delete any address, all addresses, or the account.

## 2. How the product got here

The original brief described a fundraising outreach assistant: read one page on demand, extract one person's details,
draft a personal email for them, save, export. The owner changed the product on 25 October 2026, in this order. Each
change overrides parts of the brief and was made at the owner's explicit request after the trade offs were explained:

| Change | Overrides in the original brief |
|---|---|
| Saved data deleted 3 hours after it is saved, to keep database storage small | "retention until the user deletes" |
| Fault isolation: database or AI outages do not take down unrelated features | (addition) |
| Automatic collection on every page (opt in) | "never reads pages silently", "never collects lists", "no bulk or background collection", "no all_urls" |
| General purpose, not fundraising | the fundraising tuning, sender profile, voice samples, footer, goal dial |
| Emails only, automatic sheets of 200, optional one message per sheet | page reading, field extraction, per person drafts, the confirm step, the Prospect page |

The legal position of collecting addresses for unsolicited email (GDPR and PECR in the EU and UK, CAN-SPAM in the US)
was raised with the owner and is the operator's responsibility. Every draft ends with an offer to stop ("If this isn't
relevant, just reply and I won't follow up"), because unsolicited commercial email generally needs an opt out.

## 3. Tech stack, versions and why

All versions were checked on 25 October 2026 (`npm view`), are current stable releases, and `npm audit` reports 0
vulnerabilities. Versions are pinned exactly and `package-lock.json` is committed.

| Package | Version | Where | Why |
|---|---|---|---|
| Node.js | 24 LTS (24.21.0 tested) | server, tooling | Current LTS line |
| npm workspaces | npm 11.19 | root | Monorepo without extra tooling. npm 11 gates install scripts: `argon2`, `esbuild` and `mongodb-memory-server` were reviewed and approved in `allowScripts` |
| TypeScript | 7.0.2 | all | Type checking and the server build |
| wxt | 0.21.4 | extension | Maintained, Vite based extension framework that generates the manifest. Plasmo was rejected (development has slowed) |
| @wxt-dev/module-react | 1.2.2 | extension | React integration (brings @vitejs/plugin-react 6.1.2) |
| vite | 8.3.5 | extension (via WXT) | Bundler |
| react, react-dom | 19.3.1 | extension | UI |
| tailwindcss, @tailwindcss/vite | 4.3.3 | extension | Styling with design tokens in CSS |
| lucide-react | 1.61.0 | extension | Icons (no emojis anywhere) |
| zod | 4.6.7 | all | One schema source for validation on both sides |
| express | 5.3.0 | server | HTTP API |
| mongoose | 9.11.4 | server | MongoDB (driver 7.5.0) |
| helmet 8.3.0, express-rate-limit 8.7.1, cors 2.8.6 | | server | Security headers, rate limits, CORS for the one extension origin |
| pino 10.4.0, pino-http 11.0.0 | | server | Structured logs with strict serializers |
| argon2 0.45.1, jose 6.2.13 | | server | Password hashing (argon2id), JWT |
| openai | 7.43.0 | server | Official OpenAI SDK pointed at Groq's OpenAI compatible endpoint, so the provider is swappable by URL |
| xlsx (SheetJS CE) | 0.20.3 from cdn.sheetjs.com | server | .xlsx writing, see below |
| vitest 5.0.5, happy-dom 21.0.4, mongodb-memory-server 11.3.0, supertest 7.3.1, tsx 4.23.15 | | dev | Tests and dev runtime |

**Why a side panel.** It stays open while the user browses, so the sheet's progress is visible, and it does not close
when focus moves (a popup would).

**Groq model.** `openai/gpt-oss-120b`, read live on 25 October 2026: a production model with strict JSON schema
structured output. `llama-3.3-70b-versatile` was shut down on 16 August 2026 with gpt-oss-120b as its replacement. The
model comes only from `AI_MODEL`. At boot the server lists `GET /models` (10 s timeout) and stops if the model is
missing or the key is rejected. If Groq cannot be reached at all it retries 3 times and then starts anyway with a
warning (collection does not need the AI). A single model lookup is not used, because the SDK encodes the slash in
`openai/gpt-oss-120b` and Groq answers that with 404 (found with the real key). Published limits for this model, per
organisation: 30 requests a minute, 1,000 a day, 8,000 tokens a minute, 200,000 tokens a day. A sheet draft uses about
800 to 1,500 tokens.

**xlsx library.** ExcelJS 4.4.0 failed the check (no commits since January 2024, an open `uuid` advisory). The npm
`xlsx` package is frozen at 0.18.5 with known advisories. SheetJS Community Edition 0.20.3 from the SheetJS CDN has no
dependencies, an active repository, and both published advisories fixed before 0.20.3. It is used for writing only.
It cannot write frozen panes or wrap styles, so the Draft body column is wide and the header row has an autofilter.

## 4. Architecture and request flows

```
 Browser (Chrome or Brave)                                       Server (Node, Express)          External
 +-------------------------------------------------------+      +------------------------+
 | auto.content.ts (runtime registered, every page)      |      | /api/v1                |
 |   collectEmailsInjected() -> addresses only           |      |  helmet, HTTPS, origin |
 |        | runtime.sendMessage (validated)              |      |  allowlist, 48 KB body |
 | background.ts (service worker)                        |      |  rate limits, logs     |
 |   icon click, menu item, Alt+Shift+O:                 |      |  auth routes           |
 |     sidePanel.open (sync) + executeScript(collector)  |      |  requireAuth           |
 |   save -> POST /prospects/collect ------------------- +----->|  collect, list, sheets +---> MongoDB Atlas
 |   alarm each minute + after each save:                |      |  draft a sheet --------+---> Groq
 |     GET /prospects/sheets, download ready sheets      |      |  export .xlsx          |
 |     (chrome.downloads), close the current one         |      +------------------------+
 | side panel (React): Emails view, Settings             |
 +-------------------------------------------------------+
```

**Automatic collection.** The content script runs at `document_idle` in the top frame of every page (except the never
collect list), finds visible addresses (mailto links and plain text, at most 50) and looks again 4 s later for content
that renders late. Plain text is read the way it looks: pieces inside one block are joined before matching, because pages
often split an address into several elements (Google bolds the searched words, so `bakery.usa@gmail.com` arrives as
`bakery` + `.` + `usa` + `@` + `gmail` + `.com`). A piece starting with a capital or a space, such as a "Read more"
link after a cut off address, is kept separate, so it never completes a fake address. Verified in real Brave on a
Google style results page: all 9 complete addresses found, the cut off one ignored. It sends `{ url, title, emails }` to the service worker, which accepts it only from its own content
script in a top frame, validates it, and calls `POST /prospects/collect`. The badge on the icon shows how many
addresses the page had. Then it checks the sheets (section 7).

**Collect on click.** The icon click (also the shortcut and the menu item) opens the panel synchronously and injects
`collectEmailsInjected` into that tab with `chrome.scripting.executeScript` (allowed by activeTab), then saves the
result the same way. It writes a short result (`lastCollect`) to session storage, which the panel shows: "8 new emails
saved", "No email addresses on this page", "This site is off limits", "Chrome doesn't allow reading this page", or
"Couldn't save them" (not signed in or server down).

**Server, collect.** Validates the request, removes any of these addresses that already expired, skips the ones
already saved (one row per address per user, so revisiting a page never duplicates), reserves the next sheet slots for
the new ones and inserts them with status `new` and a 3 hour expiry.

**Drafting** is in section 8.

## 5. Chrome and Brave behaviour, permissions

| Permission | Why |
|---|---|
| `activeTab` | Collect from the clicked tab when automatic collection is off |
| `scripting` | Inject the collector on click, and register the automatic content script |
| `sidePanel` | The UI |
| `contextMenus` | "Collect emails on this page" |
| `storage` | Tokens, the last collect result, downloaded sheet numbers, the last drafted message |
| `downloads` | Save sheets to the Downloads folder without the panel open |
| `alarms` | Check once a minute whether a sheet is ready |
| `host_permissions`: the API origin only | So the extension can call the backend |
| `optional_host_permissions`: `https://*/*`, `http://*/*` | Requested only when the user turns on automatic collection, removed when they turn it off, sign out or delete the account |

No popup; `openPanelOnActionClick` is off so the icon click reaches `action.onClicked`. No content script in the
manifest, no remote code, no `eval`. Production builds set a strict extension page CSP with `connect-src` limited to the
API origin. Build assertions fail the production build if the manifest mentions localhost, or if a secret pattern
(Groq key, OpenAI key, MongoDB URI with credentials, private key, `JWT_SECRET` or `AI_API_KEY` assignments) appears in
the output.

Observed in real browsers (headless, scratch profiles, 25 October 2026):

- Chrome for Testing 156: without a gesture, a tab's URL and title are hidden and `executeScript` is refused.
- Brave 155: the optional all sites permission is declared and requested correctly. An "Only permissions specified in
  the manifest may be requested" error means the browser is still running an older build: reload the extension on the
  extensions page (closing the panel is not enough). Settings shows the build time at the bottom to check this.
- Brave asks where to save each download by default. With that on, every sheet opens a save dialog. Turn off "Ask
  where to save each file before downloading" (brave://settings/downloads) for silent saving.
- End to end in Brave: with automatic collection on, four pages of 50 addresses produced
  `Downloads/Outreach Personalizer/sheet-001.xlsx` with 200 rows by itself, the fifth page started sheet 2, and drafting
  sheet 2 put one message on all 50 rows.

## 6. Data model (MongoDB, `server/src/db/models.ts`)

| Collection | Fields | Indexes |
|---|---|---|
| users | email (unique, lowercased), passwordHash, settings { sender { name, link } }, sheet { current, count }, createdAt | email unique |
| refreshsessions | userId, familyId, tokenHash (SHA-256), expiresAt, revokedAt | tokenHash unique, familyId, userId, TTL on expiresAt |
| prospects (one saved address) | userId, email, sourceUrl (normalized), sourceTitle, subject, body, tone, length, baseInstructionsVersion, model (draft fields null until drafted), status (new, drafted, sent, replied), sheet, expiresAt, createdAt, updatedAt | unique (userId, email); (userId, createdAt desc, _id desc); (userId, status, createdAt desc, _id desc); (userId, sheet); TTL on expiresAt |
| usagecounters | userId, day (UTC), kind (draft), count, expiresAt | unique (userId, day, kind), TTL on expiresAt |

**Retention.** Each address expires `PROSPECT_TTL_HOURS` (3) after it is first saved, and the TTL index deletes it. The
TTL monitor runs about once a minute, so every query also filters `expiresAt > now`. Collecting an expired address again
saves it fresh. Older documents from earlier versions of the product may carry extra fields; they are ignored, and the
old `voicesamples` collection is unused and can be dropped.

**URL normalization** (`packages/shared/src/url.ts`) lowercases the host, removes `www.`, the fragment, credentials,
default ports and tracking parameters (`utm_*`, `gclid`, `fbclid` and others), and sorts the rest.

**Search** escapes regex characters and matches the email and page title, always inside the user's own documents.

## 7. Sheets of 200 and automatic downloads

- **Slots.** `reserveSheetSlots` hands out the next slots from a counter on the user document with compare and set, so
  tabs collecting at the same time never put more than `SHEET_SIZE` (200) addresses in one sheet. Known addresses use
  no slot.
- **Ready rule** (`extension/src/lib/sheets.ts`, `sheetsToDownload`): a sheet is downloaded by itself when it holds 200
  addresses, or when its oldest address is within 20 minutes of being deleted. Drafting does not delay it. A sheet is
  never downloaded twice by itself (downloaded numbers are kept per user in `chrome.storage.local`).
- **When it runs.** After every save, and once a minute (`alarms`), under a Web Lock so the two never overlap.
- **How it saves.** `GET /prospects/export?sheet=N` returns the .xlsx; the service worker has no DOM, so it saves it with
  `chrome.downloads.download` from a data URL to `Outreach Personalizer/sheet-NNN.xlsx`. If it was the current sheet,
  `POST /prospects/sheets/close` starts the next one.
- **Columns:** Email, Status ("not contacted", drafted, sent, replied), Date added, Found on (page title), Source URL,
  Draft subject, Draft body. Rows are in the order they were collected. Every cell is a string cell, and values
  starting with `=`, `+`, `-`, `@`, tab, carriage return or line feed (and full width variants) are prefixed with a
  quote, following the OWASP CSV injection guidance.
- **Panel.** The Sheets card shows "Sheet 3, 47 of 200 emails", a progress bar, "Download now and start a new sheet",
  and earlier sheets with Download again. A sheet drafted after it was downloaded can be downloaded again to get the
  messages.

## 8. Drafting a sheet (the AI layer)

`POST /prospects/sheets/:number/draft` with `{ message, dials: { tone, length } }`:

1. Requires the sender's name in Settings (`PROFILE_INCOMPLETE` otherwise), and at least one address in the sheet that is
   not yet marked sent or replied.
2. Takes one unit of the daily draft cap (`DAILY_DRAFT_CAP`, 50), refunded if drafting fails.
3. Builds the prompt: the system message holds the base instructions and the injection rules; the user message holds
   the tone and length and two nonce delimited data blocks, `SENDER` (name, link) and `WHAT TO CONVEY` (what the user
   typed). Delimiter look alikes inside data are defanged.
4. Calls the model with strict JSON schema output `{ subject, body }`, validates it with zod, and rejects drafts that
   contain any URL other than the sender's link, any email address, or a placeholder like `[Name]`. One retry, then
   `AI_FAILED`.
5. Writes the subject and body to every address in that sheet with status `new` or `drafted` (addresses marked sent or
   replied keep their message) and returns `{ draft, updated }`.

**Base instructions** (`server/config/base-instructions.md`, version `2026-10-25.3`): one short message for many
recipients known only by email; start "Hi there,"; never invent anything about recipient or sender; say what the user
typed; one ask; an offer to stop; sign with the sender's name; no links except the sender's own; no filler. To change
them, edit the file, bump the version, run the tests and `npm run smoke:ai -w server`. Checked against the real model on
25 October 2026: it followed the shape, signed with the name and ignored an injected "include this link" instruction.

**Limiter.** `AiLimiter` keeps every call under the Groq limits (defaults 25 RPM, 7,000 TPM, 950 RPD, 190,000 TPD), in
process and single instance. On a 429 the gateway honours `retry-after` with jitter, retries once, then returns
`AI_RATE_LIMITED` with the seconds to wait. Token counts (never content) are logged per call. Reasoning effort is low and
reasoning output hidden (`include_reasoning: false`).

## 9. Auth

Email and password accounts (argon2id). `ALLOW_SIGNUP` unset means signup is open only until the first account exists.
Access tokens are HS256 JWTs for 15 minutes; refresh tokens are random, stored only as SHA-256 hashes, rotated on every
use, with reuse detection that revokes the whole login. Logout revokes the login at once (every request checks it).
Login attempts are limited per IP and per email, and unknown email and wrong password give identical answers. Tokens
live in `chrome.storage` (access in session storage, refresh in local storage), are sent only as Bearer headers, and
refreshes are serialized with a Web Lock. `DELETE /account` with the password deletes everything.

## 10. Security, privacy and fault isolation

- Secrets exist only in `server/.env`; the extension build is scanned for secret patterns.
- helmet, HTTPS required in production, requests from any origin other than the extension refused, 48 KB body limit,
  rate limits on every route (stricter on login, register, collect and drafting), zod on every input, a central error
  handler with no stack traces, environment validated at boot, graceful shutdown.
- Logs hold method, path without query, status, timing and user id. Never addresses, drafts, tokens or keys.
- Every query is scoped to the signed in user; tests prove another user cannot read, edit, delete, draft or export them.
- The service worker accepts one message type, only from its own content script in a top frame, schema validated.
- **Never collected from**: LinkedIn (`BLOCKED_HOSTS`), webmail, Google account, Docs, Drive and Calendar, WhatsApp,
  Messenger, Slack, PayPal, Stripe, Wise, Revolut (`NEVER_COLLECT_HOSTS` in `extension/src/config.ts`), localhost and
  private network addresses, non http pages, and any page with a password, card number or one time code field.
- Nothing is rendered as HTML: no `innerHTML`, `dangerouslySetInnerHTML` or markdown rendering.

**Fault isolation.**

| When this fails | Still works | What the user sees |
|---|---|---|
| MongoDB at boot or while running | The server starts and reconnects by itself (backoff 2 s to 30 s). Health | Database routes answer at once with `503 DB_UNAVAILABLE` ("Saved data is unavailable for now") instead of hanging |
| Groq | Collecting, the list, sheets, downloads, export, settings, sign in | Drafting shows "The AI step failed" or "Busy right now" with a countdown |
| One panel view crashes | The other view | "The Emails section stopped working" with Try again |
| Signed out or server down during collection | Browsing; nothing else | The icon tooltip and the panel say the addresses were not saved |
| Clipboard | Everything else | "Copy failed, select the text instead" |
| Token refresh network error | The session | The request's own error |

`GET /health` reports `{ ok, version, db: up | down, ai: up | unreachable | unchecked }`.

## 11. Every file

### Root
`package.json` (workspaces, scripts, `allowScripts`), `package-lock.json`, `tsconfig.base.json` (strict settings and the
`source` condition that lets Vite, Vitest and tsx read `@op/shared` from its TypeScript source), `.nvmrc`, `.gitignore`,
`README.md`, `DOCS.md`, `PRIVACY.md`.

### packages/shared (the API contract)
| File | Exports |
|---|---|
| `src/config.ts` | `APP_NAME`, `API_PREFIX`, `FIELD_LIMITS`, `COLLECT_MAX_EMAILS` (50), `SHEET_SIZE` (200), `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`. Also importable alone as `@op/shared/config` (no zod, keeps the content script small) |
| `src/schemas.ts` | `Tone`, `Length`, `Dials`, `DEFAULT_DIALS`, `ProspectStatus`, `Credentials`, `LoginRequest`, `RefreshRequest`, `AuthResponse`, `DeleteAccountRequest`, `SenderProfile`, `EMPTY_SENDER`, `Settings`, `CollectRequest`, `CollectResponse`, `Prospect`, `ProspectFilter`, `ProspectListQuery`, `ProspectList`, `ProspectPatch`, `DeleteAllQuery`, `DeletedCount`, `SheetSummary`, `SheetList`, `CloseSheetRequest`, `SheetDraftRequest`, `DraftOutput`, `SheetDraftResponse`, `ErrorCode`, `ErrorBody`, `Health`, `objectId` |
| `src/url.ts` | `normalizeUrl` |

### server
| File | Purpose |
|---|---|
| `config/base-instructions.md` | The tracked drafting instructions with their version |
| `.env.example` | Every environment variable with its default |
| `src/env.ts` | `loadEnv`: zod validated environment, clear boot errors |
| `src/index.ts` | Boot: env, base instructions, `verifyModel` (retries, tolerates an unreachable provider), limiter, gateway, `createApp`, listen, then `connectDatabase` in the background with retries; graceful shutdown |
| `src/app.ts` | `createApp`: middleware order, the database guard (fail fast while disconnected), routes, 404, central error handler |
| `src/context.ts` | `AppContext`, the dependencies passed to routes |
| `src/lib/errors.ts`, `validate.ts`, `logger.ts`, `rateLimits.ts`, `dbStatus.ts` | `AppError` helpers, `parse`, logging, rate limits (`globalIp`, `login`, `register`, `refresh`, `user`, `ai`, `collect`), database status and error classification |
| `src/db/models.ts` | `User`, `RefreshSession`, `Prospect`, `UsageCounter`, `syncIndexes` |
| `src/auth/passwords.ts`, `tokens.ts`, `sessions.ts`, `middleware.ts` | argon2id, JWT and refresh tokens, rotation with reuse detection, `requireAuth`, `userIdOf` |
| `src/ai/provider.ts` | `AiProvider` interface, `OpenAiCompatibleProvider`, `ProviderError`, `ProviderUnreachableError` |
| `src/ai/limiter.ts`, `gateway.ts` | `AiLimiter`, `estimateTokens`; `AiGateway` (limiter, one retry, usage logs, error mapping) |
| `src/ai/baseInstructions.ts`, `prompts.ts` | Loading the instructions; `buildSheetPrompt`, `block`, `INJECTION_RULES`, `DRAFT_JSON_SCHEMA` |
| `src/services/prospects.ts` | User scoped repository: `collectEmails`, `listProspects` (cursor), `prospectsForExport`, `getProspect`, `updateProspect`, `deleteProspect`, `deleteAllProspects`, `applySheetDraft`, `countDraftable` |
| `src/services/sheets.ts` | `reserveSheetSlots`, `closeSheet`, `listSheets` |
| `src/services/draft.ts` | `generateSheetDraft`, `assertDraftable`, `findOutputProblem` |
| `src/services/spreadsheet.ts` | `buildProspectWorkbook`, `EXPORT_COLUMNS`, `neutralizeCell` |
| `src/services/usage.ts` | `consumeDaily`, `refundDaily` |
| `src/routes/auth.ts`, `account.ts`, `prospects.ts` | The routes below |
| `scripts/smoke-ai.ts` | Manual real model check (one sheet draft with an injection attempt) |
| `scripts/preview-server.ts` | The real API on an in-memory MongoDB with a canned AI, for UI work without Groq or Atlas |
| `test/*` | api (35), limiter and gateway (12), prompts and output checks (8), resilience (4), sessions (7), spreadsheet (21) |

API (all under `/api/v1`; errors are `{ error: { code, message, retryAfterSeconds?, issues? } }`):

| Method and path | Auth | Body or query | Response |
|---|---|---|---|
| GET /health | no | | `Health` |
| POST /auth/register, /auth/login, /auth/refresh, /auth/logout | no | credentials or refresh token | `AuthResponse` or 204 |
| DELETE /account | yes | `{ password }` | 204 |
| GET, PUT /settings | yes | `Settings` `{ sender: { name, link } }` | `Settings` |
| POST /prospects/collect | yes | `CollectRequest` `{ url, title, emails }` | 201 `{ added, alreadySaved }` |
| GET /prospects | yes | cursor, limit, status, q, sheet | `ProspectList` |
| GET /prospects/sheets | yes | | `SheetList` |
| POST /prospects/sheets/close | yes | `{ number }` | 204 |
| POST /prospects/sheets/:number/draft | yes | `SheetDraftRequest` `{ message, dials }` | `{ draft, updated }` |
| GET /prospects/export | yes | status, q, sheet | .xlsx |
| GET, PATCH, DELETE /prospects/:id | yes | `ProspectPatch` `{ subject?, body?, status? }` | `Prospect` or 204 |
| DELETE /prospects?confirm=all | yes | | `{ deleted }` |

### extension
| File | Purpose |
|---|---|
| `wxt.config.ts` | Manifest (permissions, API host from `WXT_API_BASE_URL`, optional all sites access, shortcut, `key`, production CSP), Tailwind, the build time constant, the two build checks |
| `build-checks.ts` | `findLoopbackPermissions`, `scanDirForSecrets` |
| `.env.development`, `.env.example` | API URL for dev builds; template for `.env.production` |
| `scripts/gen-key.mjs` | Generates the key that fixes the extension id, and prints the matching `CORS_ORIGINS` |
| `entrypoints/background.ts` | Icon, menu item and shortcut collect (panel opened first), the collector message listener, saving, badges, the sheets alarm |
| `entrypoints/auto.content.ts` | The automatic collector (runtime registered only) |
| `entrypoints/sidepanel/*` | Panel entry and design tokens |
| `src/config.ts` | `API_BASE_URL`, `BLOCKED_HOSTS`, `NEVER_COLLECT_HOSTS`, `RESTRICTED_HOSTS`, timeouts |
| `src/lib/collector.ts` | `collectEmailsInjected` (self-contained, injectable), `mayCollect` |
| `src/lib/reader.ts` | `classifyUrl`, `collectFromTab` |
| `src/lib/sheets.ts` | `sheetsToDownload`, `downloadSheet`, `runSheetCheck`, `downloadedSheets`, `sheetFileName` |
| `src/lib/autoCollect.ts` | Turning automatic collection on (permission request plus registration) and off, `syncAutoCollect` |
| `src/lib/messages.ts`, `lastCollect.ts` | The collector message schema; the on click result shown in the panel |
| `src/lib/api.ts`, `http.ts`, `auth.ts`, `storage.ts`, `expiry.ts` | Typed API client, fetch with timeouts and error codes, tokens and refresh, validated storage, countdown helpers |
| `src/env.d.ts` | Declares the build time constant |
| `src/App.tsx` | Sign in gate, two tabs (Emails, Settings), offline notice, error boundaries |
| `src/views/EmailsView.tsx` | Last collect notice, Sheets card, the optional message composer with preview and copy, the saved list (search, status filter, status change, delete, export, delete all) |
| `src/views/SettingsView.tsx` | Your name and link, automatic collection switch, privacy note, sign out, delete account, build time |
| `src/views/SignInView.tsx` | Sign in and create account |
| `src/components/ui.tsx`, `ErrorNotice.tsx`, `ErrorBoundary.tsx` | UI primitives, error messages per code, per view crash containment |
| `test/*` | collector (11, with `fixtures/team.html` and `fixtures/search-results.html`), URL rules and build checks (15), sheet rule (5) |

## 12. Setup

1. Node 24, then `npm install` at the root.
2. **Groq**: create a key at console.groq.com/keys, **enable Zero Data Retention** under Settings, Data Controls, and
   check your limits at console.groq.com/settings/limits.
3. **MongoDB Atlas**: a cluster, a database user, and your IP under Network Access. Copy the `mongodb+srv://` string with
   a database name (for example `/outreach`).
4. `cd extension && node scripts/gen-key.mjs`: put `WXT_EXTENSION_KEY` in `extension/.env.development.local` and
   `.env.production`, and the printed origin in the server's `CORS_ORIGINS`.
5. `cp server/.env.example server/.env` and fill `MONGODB_URI`, `CORS_ORIGINS`, `JWT_SECRET`, `AI_API_KEY`, `AI_MODEL`.
6. `npm run dev:server`. Optionally `npm run smoke:ai -w server` to see a real draft.
7. `npm run build:dev -w extension`, then load `extension/.output/chrome-mv3-dev` unpacked (chrome://extensions or
   brave://extensions, Developer mode). After every rebuild, click the extension's reload arrow there.
8. In the browser's download settings, turn off "Ask where to save each file before downloading".
9. Production: `extension/.env.production` with the https API URL and key, `npm run build -w extension`, `npm run zip`.
   Server: `npm run build`, `NODE_ENV=production npm start -w server` behind HTTPS (`TRUST_PROXY_HOPS=1` behind one proxy).

The extension reads `WXT_*` variables from `.env.[mode]` files. They ship to users, so they must never hold secrets.

## 13. Testing and the manual QA checklist

`npm test` runs 124 tests (shared 6, server 87, extension 31) with the AI mocked; server tests use an in-memory MongoDB.
`npm run typecheck` checks everything. The automated tests cover: URL normalization; the collector on a team page
(mailto and text addresses, hidden ones and image names skipped, the 50 cap, nothing from scripts or form fields, and that
the function is self-contained); addresses split across highlighted words on a search results page, and lines that must
not merge; the never collect rules; the URL rules and build checks; the sheet download rule;
signup flag, auth, rotation and reuse detection; settings; collecting (no duplicates, validation, no AI); sheets of 200
(rollover, close, per sheet export); drafting a sheet (name required, one AI call, all rows updated, sent ones kept,
empty sheet refused, validation, foreign link retry and cap refund); list, search, status, delete, export with formula
neutralization; cross user isolation; 3 hour retention; account deletion; database and AI outages.

By hand (real browser gestures and downloads cannot be fully automated):

- [ ] After loading or reloading, Settings shows today's build time.
- [ ] Click the icon on a page with addresses: the panel opens and says how many were saved; the icon shows a number.
- [ ] Right click a page, "Collect emails on this page", and Alt+Shift+O do the same.
- [ ] On LinkedIn, a PDF and chrome://extensions, the panel explains why nothing was collected.
- [ ] Settings: add your name, turn on automatic collection and accept the prompt. Browse a few pages with addresses:
      the Sheets card counts up. Webmail and sign in pages collect nothing.
- [ ] With "Ask where to save" off, Download now saves `Downloads/Outreach Personalizer/sheet-001.xlsx` without a dialog
      and starts sheet 2. At 200 addresses it happens by itself.
- [ ] Type a message, Draft for a sheet: the preview appears with copy buttons, the rows show Drafted, and Download again
      gives a file with the draft columns filled.
- [ ] Turn automatic collection off: the extensions page shows the site access removed.
- [ ] Stop the server and click the icon: the panel says the addresses were not saved. Block Atlas access: the panel
      shows "Saved data is unavailable for now".
- [ ] Narrowest panel width (no sideways scroll), dark mode, keyboard only with a visible focus ring, reduced motion.

## 14. Defaults

| Setting | Default | Where |
|---|---|---|
| Model | `openai/gpt-oss-120b`, reasoning low | `AI_MODEL`, `AI_REASONING_EFFORT` |
| Draft output tokens | 1,200 | `AI_MAX_OUTPUT_TOKENS_DRAFT` |
| Limiter | 25 RPM, 7,000 TPM, 950 RPD, 190,000 TPD, 15 s max wait | `AI_LIMIT_*` |
| Sheet drafts per user per day | 50 | `DAILY_DRAFT_CAP` |
| Retention | 3 hours from first save | `PROSPECT_TTL_HOURS` |
| Sheet size | 200 | `SHEET_SIZE` |
| Early sheet download | 20 minutes before the oldest address expires | `EXPIRY_MARGIN_MS` |
| Addresses per page | 50 | `COLLECT_MAX_EMAILS` |
| Collect rate | 60 pages a minute per user | `rateLimits.ts` |
| Tone and length | friendly (`warm`), short | `DEFAULT_DIALS` |
| Signup | open until the first account exists | `ALLOW_SIGNUP` |
| Access and refresh lifetimes | 15 minutes, 30 days | `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` |
| Shortcut | Alt+Shift+O | `wxt.config.ts` |

## 15. Known limits

- Single instance: the AI limiter and rate limit counters are in memory.
- Addresses written as "name [at] site", drawn as images, inside iframes or in shadow DOM are not found.
- Single page apps are scanned at load and once 4 s later, not on later in page navigation.
- One message per sheet, the same for everyone, because only the address is known.
- A sheet downloaded before drafting does not include the draft: download it again after drafting.
- Retention is a hard delete with no recycle bin. The automatic download before expiry is the safeguard; if the browser
  is closed when a sheet would have been saved early, its oldest addresses can expire first.
- The browser's "Ask where to save" setting turns every automatic download into a dialog.
- Groq's free tier: about 1,000 requests a day for the whole organisation.
- PRIVACY.md is a draft and needs legal review.
