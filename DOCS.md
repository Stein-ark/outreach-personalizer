# Outreach Personalizer: developer documentation

Last updated 25 October 2026, after Phase 4 plus three owner requested changes: 3 hour retention, fault isolation,
and optional automatic collection (section 1b). This file is the single source of truth for how the project is built,
why, and how to run and test it. Keep it in sync with the code.

Contents

1. What it is and what is built
2. Tech stack, versions and why each part was chosen
3. Architecture and the end to end request flow
4. Chrome behaviour: activeTab, the side panel and the gesture rule (with what was observed)
5. Permissions and why each exists
6. Data model
7. Auth flow
8. AI layer: base instructions, prompt assembly, injection defences, token budget and limiter
9. Export (.xlsx) and formula injection
10. Security and privacy controls
11. Every file: purpose, exports and connections
12. Setup: Groq, Zero Data Retention, MongoDB Atlas, environment, running, loading, building
13. Testing, and the manual QA checklist (what you must test by hand)
14. Default decisions made
15. Known limits

## 1. What it is and what is built

A Chrome (Manifest V3) extension that works as an assistant on the page the user already has open. The user opens a
prospect's page (an investor bio, a founder's site, a company page) and invokes the extension. It then:

1. reads that one page, on demand (or uses text the user selected or pasted),
2. extracts the prospect's details, deterministically first and with the AI only for gaps,
3. shows the details as editable fields that the user must confirm,
4. drafts a short, personalized fundraising email in the user's voice, showing which prospect detail the opener uses,
5. saves the prospect and draft to the user's list (status drafted, sent, replied) for **3 hours**,
6. exports the list to .xlsx with the draft in its own column. Users export before the 3 hours are up, because saved
   prospects are then deleted from the database to keep storage small (section 6).

It never crawls, follows links, guesses or verifies emails, or sends email. By default it never reads a page silently
or collects lists. The one exception is **automatic collection**, which is off until the user turns it on (section 1b).

## 1b. Automatic collection (opt in, owner decision of 25 October 2026)

**This overrides four fixed rules of the original brief** ("never reads pages silently", "never collects lists", "do
not build bulk or background collection" and "no all_urls"), at the owner's explicit request. The owner was told the
privacy, Chrome Web Store and anti spam law implications before choosing. It was built to limit those risks:

- **Off by default.** Turned on in Settings with "Turn on automatic collection". That click asks Chrome for access to
  all websites (`optional_host_permissions`). Turning it off, signing out or deleting the account removes the permission
  and the script.
- **What runs.** A small content script (6 KB, `entrypoints/auto.content.ts`) registered at runtime with
  `chrome.scripting.registerContentScripts`, at `document_idle`, top frame only, and again 4 s later for content that
  renders late. It finds every visible email address (mailto links and plain text, at most 50 per page) and the
  person's name next to it (the link text, or the name line in the same card, never borrowed from a block holding
  several addresses). Shared inboxes such as info@ and press@ are saved without a name.
- **What leaves the browser.** Only `{ url, title, people: [{ email, name }] }`, sent by the service worker to
  `POST /prospects/collect`. No page text, and **no AI call**. The AI is used only when the user drafts.
- **Where it never runs**: `BLOCKED_HOSTS` (LinkedIn), `NEVER_COLLECT_HOSTS` in `extension/src/config.ts` (webmail,
  Google account, Docs, Drive and Calendar, WhatsApp, Messenger, Slack, PayPal, Stripe, Wise, Revolut), localhost and
  private network addresses, non http pages, and any page with a password, card number or one time code field. These
  hosts are excluded both in the registration (`excludeMatches`) and in the script (`mayCollect`).
- **Saving.** Each address becomes a prospect with status `new` ("Not contacted"), `sourceMode: auto`, no draft, and the
  usual 3 hour expiry. One prospect per email per user: a person already saved (collected or drafted) is left untouched,
  so collection never overwrites a draft or an edit. Drafting a collected person updates that same prospect.
- **Feedback.** The toolbar badge shows how many people the current page had, and its tooltip how many were new.
  If the user is signed out or the server is down, collection quietly pauses (tooltip says so). Nothing else is affected.
- **Rate limit.** `POST /prospects/collect` allows 60 requests per minute per user.
- **Legal.** Collecting addresses for unsolicited email is regulated (for example GDPR and PECR in the EU and UK,
  CAN-SPAM in the US, which treats harvested addresses as an aggravating factor). The Settings screen says so. Compliance
  is the operator's responsibility, and PRIVACY.md discloses the feature.

Verified in a real browser (Chromium 156, fake hostnames mapped to a local fixture server): a team page with 8
addresses gave a badge of 8 and 8 "Not contacted" entries. The same page served as linkedin.com and a page with a
password field collected nothing. Opening a collected person and drafting turned that entry into "drafted" with no
duplicate.

**One click mode got an email picker too.** When a page has several addresses, the Email field lists them all, with the
likeliest match for the name first, so the user picks the right one instead of the extension guessing.

Status of the build phases:

| Phase | Scope | Status |
|---|---|---|
| 0 | Plan, live verification, monorepo, WXT shell, server, shared package, docs | Done |
| 1 | On demand read, three input modes, blocked hosts, /extract, editable fields, auth | Done |
| 2 | Base instructions, prompt assembly, /draft, dials, sender profile, voice samples, injection defences, limiter | Done |
| 3 | Save and list prospects, status, search, cursor pagination, .xlsx export | Done |
| 4 | Error states, accessibility pass, security review, bundle secret scan, PRIVACY.md, docs | Done |

Nothing was cut. One brief item is only partially possible: the .xlsx library chosen cannot write frozen panes or
text wrap (section 9).

## 2. Tech stack, versions and why

All versions were checked against the npm registry on 25 October 2026 (`npm view`), are the current stable release
(no deprecated, abandoned or pre-release packages), and `npm audit` reports 0 vulnerabilities. Versions are pinned
exactly in each `package.json`, and `package-lock.json` is committed.

| Package | Version | Where | Why |
|---|---|---|---|
| Node.js | 24 LTS (24.21.0 tested) | server, tooling | Current LTS line. `.nvmrc` and `engines` pin it |
| npm workspaces | npm 11.19 | root | Monorepo with no extra tool. npm 11 also gates install scripts (see below) |
| TypeScript | 7.0.2 | all | Current stable (the native compiler). Used only for type checking and the server build |
| wxt | 0.21.4 | extension | Maintained, Vite based extension framework that generates the manifest and builds. Plasmo was rejected (development has slowed) |
| @wxt-dev/module-react | 1.2.2 | extension | Official WXT React integration (brings @vitejs/plugin-react 6.1.2) |
| vite | 8.3.5 | extension (via WXT) | Bundler used by WXT and Vitest. No hand rolled bundler config |
| react, react-dom | 19.3.1 | extension | UI |
| tailwindcss, @tailwindcss/vite | 4.3.3 | extension | Styling with design tokens in CSS |
| lucide-react | 1.61.0 | extension | Icon library. No emojis anywhere |
| zod | 4.6.7 | all | One schema source for validation on both sides |
| express | 5.3.0 | server | Current stable major. Native async error handling |
| mongoose | 9.11.4 | server | MongoDB ODM (driver 7.5.0) |
| helmet | 8.3.0 | server | Security headers |
| express-rate-limit | 8.7.1 | server | Per IP and per user limits |
| cors | 2.8.6 | server | CORS headers for the single allowed extension origin |
| pino, pino-http | 10.4.0, 11.0.0 | server | Structured logs with strict serializers |
| argon2 | 0.45.1 | server | argon2id password hashing (prebuilt native binary) |
| jose | 6.2.13 | server | JWT signing and verification |
| openai | 7.43.0 | server | Official OpenAI SDK pointed at Groq's OpenAI compatible endpoint. Keeps the provider swappable by base URL |
| xlsx (SheetJS CE) | 0.20.3 from cdn.sheetjs.com | server | .xlsx writing. See the library decision below |
| vitest | 5.0.5 | all | Tests |
| happy-dom | 21.0.4 | extension tests | DOM for running the injected reader against fixtures |
| mongodb-memory-server | 11.3.0 | server tests | Real MongoDB in memory for integration tests |
| supertest | 7.3.1 | server tests | HTTP assertions |
| tsx | 4.23.15 | server dev | Runs TypeScript in development and scripts |
| @types/node | 24.19.2 | server | Matches the Node 24 runtime |
| @types/express, @types/cors, @types/supertest, @types/react, @types/react-dom | 5.0.6, 2.8.19, 7.2.1, 19.3.0, 19.3.0 | dev | Types |

**npm install scripts.** npm 11 only runs install scripts that are approved in the root `allowScripts` field. Three were
reviewed and approved: `argon2` (selects its prebuilt binary), `esbuild` (verifies its platform binary) and
`mongodb-memory-server` (downloads the MongoDB binary used by tests).

**Why WXT.** It is actively maintained, built on Vite, generates `manifest.json` from config, handles MV3 service worker
bundling, and has first class side panel support (`entrypoints/sidepanel/` becomes `side_panel.default_path`).

**Why the side panel and not a popup.** A popup closes as soon as focus leaves it, and extracting plus drafting takes
several seconds. The side panel stays open across tabs, which also lets the extension tell the user when the page under
the panel no longer matches the work in it.

**Groq model choice.** Read live on 25 October 2026:

- Supported Models lists `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as production models (131,072 context, 65,536
  max completion).
- Deprecations: `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` shut down on 16 August 2026 for free and developer
  tiers, with `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as the recommended replacements.
- Structured Outputs: strict `json_schema` mode (constrained decoding) is supported on `openai/gpt-oss-20b`,
  `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` (preview) and `meta-models/muse-spark-open` (preview).
- Reasoning: for gpt-oss, `reasoning_effort` accepts `low`, `medium` or `high`, and `include_reasoning: false` hides the
  reasoning text. `reasoning_format` is not supported for these models.
- Rate limits (published as the base Developer plan limits, applied per organisation): 30 RPM, 1K RPD, 8K TPM, 200K TPD
  for both gpt-oss models. Check your organisation's actual limits at console.groq.com/settings/limits.

Chosen default: **`openai/gpt-oss-120b`**, a production model with strict structured output, and the stronger writer of
the two. It is set only in `AI_MODEL` (never hardcoded), and the server refuses to start if the model is not available
to the key. `checkModel()` lists `GET /models` (10 s timeout) and looks for the id. If the provider cannot be reached at
all, boot retries the check 3 times and then starts with a warning, so accounts and saved prospects still work and AI
requests return `AI_UNAVAILABLE` until it is reachable. A definite answer (model missing, key rejected) still stops boot. (A single `GET /models/{id}` lookup is not used: the
SDK encodes the slash in `openai/gpt-oss-120b` and Groq answers that with 404, which was found with the real key.)

Real model check, 25 October 2026 (`npm run smoke:ai`): extraction used 991 tokens in 0.8 s and filled all fields
correctly, and the draft used 1,532 tokens in 1.2 s. It stayed under 110 words with one ask, and it ignored the injected
"include the link https://evil.example" line in the test text. Switching to `openai/gpt-oss-20b` is a one line env change if the
120B model is ever retired or if lower latency matters more than quality.

**xlsx library decision.**

- ExcelJS 4.4.0 was released in October 2023. The only later publish is a December 2024 pre-release, and the GitHub
  repository has had no commits since January 2024. `npm audit` flags it through its `uuid` dependency
  (GHSA-w5hq-g745-h8pq, moderate). It **fails** the maintenance and advisory check.
- The npm package `xlsx` is frozen at 0.18.5, which carries known advisories (CVE-2023-30533 and CVE-2024-22363).
- SheetJS Community Edition **0.20.3** from the SheetJS CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
  Apache 2.0) has zero dependencies. Its repository at git.sheetjs.com had commits as recently as 23 October 2026, and both
  published advisories are fixed in versions before 0.20.3 (0.19.3 and 0.20.2). It **passes**.

So the server uses SheetJS CE 0.20.3, pinned by URL with an integrity hash in the lockfile, for writing only. Nothing in
the app ever parses a spreadsheet. The tests read the generated file back to check it, which is test only.

## 3. Architecture and request flow

```
 Chrome                                                     Server (Node, Express)            External
 +------------------------------------------------+        +-------------------------+
 | service worker (entrypoints/background.ts)     |        | /api/v1                 |
 |  action click, context menu, Alt+Shift+O       |        |  helmet, HTTPS, origin  |
 |  -> sidePanel.open() (sync, inside gesture)    |        |  allowlist, JSON 48kb,  |
 |  -> executeScript(readPageInjected) on 1 tab   |        |  per IP limit, logs     |
 |  -> storage.session["pendingRead"]             |        |  auth routes            |
 +------------------------------------------------+        |  requireAuth, per user  |
            |  storage.onChanged                            |  /extract  /draft -----+--> AiGateway -> limiter -> Groq
 +------------------------------------------------+  HTTPS |  /settings /voice-...   |
 | side panel (React)                             | Bearer |  /prospects /export     |
 |  consumes pendingRead, deterministic hints,    +------->|  services -> Mongoose --+--> MongoDB Atlas
 |  /extract, confirm, /draft, edit, save, list,  |        +-------------------------+
 |  export (blob download), settings              |
 |  work item in storage.session                  |
 +------------------------------------------------+
```

End to end, for a page read:

1. The user clicks the toolbar icon on a prospect's page (or uses the context menu or shortcut). Chrome grants
   activeTab for that tab and fires `action.onClicked`.
2. `background.ts` calls `chrome.sidePanel.open({ windowId })` synchronously, before any `await`, so the gesture
   is not lost.
3. Still inside that handler's async continuation, `readTab()` classifies the URL. Restricted pages (chrome://, the Web
   Store, the PDF viewer, non http) and blocked hosts (linkedin.com) are not scripted. Otherwise it runs
   `chrome.scripting.executeScript` with the self contained `readPageInjected` function in the isolated world, main
   frame only.
4. The injected function returns only a `PageSnapshot`: title, URL, meta description, Open Graph tags, JSON-LD Person or
   Organization fields, headings, mailto addresses, and cleaned visible text capped at 6,000 characters. The service
   worker validates it with zod and writes `{ at, result }` to `chrome.storage.session` under `pendingRead`.
5. The panel, open now, sees the change, removes `pendingRead` at once (exactly once processing), computes deterministic
   hints (`hintsFromSnapshot`), creates a work item in session storage and calls `POST /extract`. The raw text exists
   only in memory in the panel from here on.
6. The server validates the body with the shared schema, takes one unit of the user's daily extract cap, drops any hint
   it cannot verify in the text, asks the model only for missing fields (strict JSON schema), checks each model value
   against the source (name, company and email must appear literally), and returns fields plus their origin.
7. The user edits and confirms the fields, sets the dials and clicks Draft email. `POST /draft` checks the sender
   profile, takes one unit of the daily draft cap, assembles the prompt (section 8), validates the output, appends the
   footer, upserts the prospect (normalized URL, unique per user) and returns the draft and prospect.
8. The panel shows the draft as a letter, with `detailUsed` pinned beside it. Edits are kept in session storage, and
   "Save changes" sends `PATCH /prospects/:id`.
9. The Saved tab lists prospects with cursor pagination. Export calls `GET /prospects/export` with the same filters and
   downloads the blob.

## 4. Chrome behaviour around activeTab and the side panel

Design rules (from the Chrome docs, verified 25 October 2026 at developer.chrome.com/docs/extensions/reference/api/sidePanel):

- `sidePanel.open()` (Chrome 116+) may only be called in response to a user action: an action click, a keyboard
  shortcut, a context menu click, or a user gesture on an extension page. The manifest sets `minimum_chrome_version: 116`.
- activeTab is granted only by a direct gesture on the extension (toolbar icon, its context menu item, its shortcut),
  never by a button inside the side panel. The grant lasts until the tab navigates to a different origin or closes.
- No popup is defined and `openPanelOnActionClick` is explicitly set to false at install, so the icon click fires
  `action.onClicked`. The `_execute_action` command (Alt+Shift+O by default, changeable at chrome://extensions/shortcuts)
  fires the same event.
- The panel's "Re-read" button calls the same `readTab()` from the panel. It works only while the activeTab grant for that
  tab is still live. When it is refused, the panel says to click the extension icon on the page.

Observed in a real browser (Chrome for Testing 156.0.8078.4, unpacked dev build, 25 October 2026):

- The side panel page loads, signs up against the API, saves settings, reads pasted text, extracts, drafts, saves and
  lists end to end. Screenshots were reviewed at 320px and 360px, light and dark, and there is no horizontal overflow at
  320px.
- From the extension, with no gesture on an ordinary http page, `chrome.tabs.query` returns that tab with **url and
  title hidden**, and `chrome.scripting.executeScript` is **refused** with "Cannot access contents of the page.
  Extension manifest must request permission to access the respective host." `readTab()` maps both cases to the
  `no_access` notice ("Click the extension icon on the page first").
- Not automatable: a real toolbar click, context menu click or keyboard shortcut cannot be synthesized through the
  DevTools protocol, so the granted path (steps 1 to 4 above) **must be checked by hand** with the checklist in section 13.

## 5. Permissions

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the one tab the user invoked the extension on. This is the only page access the extension has |
| `scripting` | `chrome.scripting.executeScript` to run the reader on that tab |
| `sidePanel` | The UI surface, and `sidePanel.open()` from the gesture handlers |
| `contextMenus` | "Draft outreach for this page" and "Draft outreach from selected text" |
| `storage` | Tokens (local), the in progress prospect and the read hand off (session) |
| `host_permissions`: the API origin only | So the panel can call the backend. Production is the https API origin. Dev builds use `http://localhost:8787/*` |
| `optional_host_permissions`: `https://*/*`, `http://*/*` | Not granted at install. Requested only when the user turns on automatic collection, removed when they turn it off (section 1b) |

There is no `<all_urls>` in the required permissions, no `tabs` permission, no content script in the manifest (the
collector is registered at runtime only while collection is on), no remote code and no `eval`.
Production builds set a strict extension page CSP:
`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src <API origin>; img-src 'self' data:; style-src 'self'; default-src 'self'`.
The dev build leaves the CSP to WXT, which needs its dev server origin.

Build assertions (in `extension/wxt.config.ts` and `extension/build-checks.ts`):

- `build:manifestGenerated`: in production mode the build fails if any permission, host permission or the CSP mentions
  localhost, 127.x.x.x, 0.0.0.0 or [::1]. Verified: building production with `WXT_API_BASE_URL=http://localhost:8787` fails.
- `build:done`: every text file in the output is scanned for Groq keys (`gsk_`), OpenAI style keys, MongoDB URIs with
  credentials, private key blocks and `JWT_SECRET` or `AI_API_KEY` assignments. Verified: planting a fake `gsk_` key in
  `public/` fails the build.

## 6. Data model (MongoDB, `server/src/db/models.ts`)

| Collection | Fields | Indexes |
|---|---|---|
| users | email (unique, lowercased), passwordHash, settings { sender { name, role, organisation, offer, link }, defaultDials { tone, length, goal }, footer }, createdAt | email unique |
| refreshsessions | userId, familyId, tokenHash (SHA-256), expiresAt, revokedAt | tokenHash unique, familyId, userId, TTL on expiresAt |
| voicesamples | userId, text, createdAt | userId + createdAt |
| prospects | userId, name, role, company, bio, detail, email, sourceUrl (normalized), sourceTitle, sourceMode (page, selection, paste, auto), pageKey, subject, body, detailUsed, tone, length, goal, baseInstructionsVersion, model (the draft fields are null until drafted), status (new, drafted, sent, replied), expiresAt, createdAt, updatedAt | unique partial (userId, pageKey) where pageKey is a string; unique partial (userId, email) where email is a string; (userId, createdAt desc, _id desc); (userId, status, createdAt desc, _id desc); TTL on expiresAt |
| usagecounters | userId, day (UTC yyyy-mm-dd), kind (draft or extract), count, expiresAt | unique (userId, day, kind), TTL on expiresAt |

Three fields were added beyond the brief: `detailUsed` (the export has a "Detail used" column), `sourceMode`, and
`expiresAt` (the retention rule below). `usagecounters` implements the per user daily cap. Raw page text is never
stored.

**3 hour retention.** To keep database storage small, saved prospects are temporary. Each prospect gets
`expiresAt = first save + PROSPECT_TTL_HOURS` (default 3), and a TTL index makes MongoDB delete it after that. The rules:

- The clock starts at the first save. Re-drafting or editing a saved page does not extend it, so the deadline the user
  sees never moves.
- MongoDB's TTL monitor runs about once a minute, so every query also filters `expiresAt > now`. A prospect disappears
  from the list, export, open, edit and delete at the exact moment the UI said it would.
- Drafting a page again after its prospect expired saves it fresh with a new window (a lingering expired copy is
  removed first, so it is never revived with its old deadline).
- The panel shows the deadline everywhere it matters: "Saved until 14:32" on the draft, "Deleted in 1 h 12 min" on
  each saved row, and a note above the list. When any prospect has under 30 minutes left, the note becomes a warning
  and Export becomes the primary button. Opening a prospect that has expired returns a message telling the user to
  export earlier and draft again.
- Not affected: accounts, settings, voice samples and sign in sessions (all small and needed between visits).

**URL normalization** (`packages/shared/src/url.ts`): lowercases the host, removes `www.`, the fragment, credentials,
default ports and known tracking parameters (`utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_eid`, `ref`, `trk`, `si` and
others), sorts the remaining parameters, and drops a trailing slash on deeper paths. It is the dedupe key, so drafting
the same page again updates the prospect instead of creating a new one.

**Search** escapes regex metacharacters and matches case insensitively on name, company, role, email and source title,
always inside the `userId` filter. A text index was not used because partial words ("North" for "Northwind") matter more
here than ranking. Search on a large list is a scan of that one user's documents (see Known limits).

## 7. Auth flow

- **Register** (`POST /auth/register`): zod checks email and a password of 10 to 200 characters, the password is hashed
  with argon2id (memory 19 MiB, time 2, parallelism 1, the OWASP baseline), the user is created, and a session starts.
  `ALLOW_SIGNUP` unset means signup is open only while the users collection is empty. `true` or `false` forces it.
- **Login** (`POST /auth/login`): limited to 10 attempts per 15 minutes per IP and 10 per email. Unknown email and wrong
  password return the identical 401 body, and an unknown email still runs a full argon2 verify against a dummy hash so
  timing does not reveal accounts.
- **Tokens**: the access token is an HS256 JWT (issuer, audience, subject = user id, `sid` = session family) that lives
  `ACCESS_TOKEN_TTL_SECONDS` (900 by default). The refresh token is 32 random bytes (base64url). Only its SHA-256 hash is
  stored, which is safe because the token has full entropy.
- **Refresh** (`POST /auth/refresh`): atomically consumes the presented token (`findOneAndUpdate` where `revokedAt` is
  null) and issues a new one in the same family. Presenting an already consumed token is reuse: the whole family is
  revoked and both copies stop working. Two concurrent refreshes with one token: exactly one wins (tested).
- **Logout** (`POST /auth/logout` with the refresh token): revokes the family. `requireAuth` checks that the family still
  has a live token on every request, so logout is immediate, not after 15 minutes.
- **Delete account** (`DELETE /account` with the password): deletes prospects, voice samples, sessions, usage counters and
  the user.
- **Client side**: the access token lives in `chrome.storage.session` (memory only, readable only by extension pages and
  the service worker), and the refresh token in `chrome.storage.local`, so a browser restart does not sign the user out.
  Bearer header only, `credentials: 'omit'`, no cookies. Refreshes run under a Web Lock (`op-auth-refresh`) shared by all
  extension pages, because two parallel refreshes would trip reuse detection. Only a definite 401 from refresh signs the
  user out, while network failures keep the session. The injected page function is self contained and never touches
  chrome APIs, so it never sees tokens.

## 8. AI layer

### Base instructions

`server/config/base-instructions.md`, tracked in git, starts with front matter `version: 2026-10-25.1`. It encodes the
rules from the brief: cold outreach, short (word ranges per length), lead with one real prospect detail, fundraising
flavour per goal, one ask, no filler, never invent facts about the prospect or the sender, no traction, credentials or
mutual connections not in the sender block, no URLs except the sender's link, voice samples for style only, and plain
text output. It is read at boot, is never editable from the client, and its version is stored on every prospect.

**To change it:** edit the text, bump the version (for example `2026-11-02.1`), run `npm test -w server` (the prompt
tests check the file loads), restart the server, and run `npm run smoke:ai -w server` to see a real draft.

### Prompt assembly (`server/src/ai/prompts.ts`)

- **System message**: base instructions plus `INJECTION_RULES`. Nothing untrusted ever goes here.
- **User message**: the dial settings (TONE, LENGTH, GOAL), then data blocks `SENDER`, `PROSPECT` and up to three
  `VOICE SAMPLE n`. Each block is wrapped as `<<<KIND id=NONCE>>> ... <<<END KIND id=NONCE>>>`, with a fresh random
  12 hex character nonce per request. Any `<<<` or `>>>` inside data is replaced with look alike characters, so page text
  cannot close its own block or open a fake one.
- The prospect email is deliberately left out of the draft prompt (the model has no use for it).
- **Extraction** uses the same structure with `PAGE META`, `KNOWN FIELDS` (deterministic hints) and `PAGE TEXT` blocks.
- **Structured output**: `response_format: json_schema` with `strict: true`, every property required and nullable
  fields as `["string","null"]`. The draft schema is `{subject, body, detailUsed}`. Outputs are validated again with
  zod. Invalid output is retried once, then the request fails with `AI_FAILED`.

### Injection and output safety

- Page, selected and pasted text are data inside nonce delimited blocks, and the system message says they are never
  instructions.
- The model has no tools, and nothing is acted on automatically. The user reviews every field and every draft.
- The reader drops hidden content before anything is sent: `display:none`, `visibility:hidden`, `hidden`,
  `aria-hidden="true"`, `inert`, opacity 0, font size under 2px, off screen positioning, clip based hiding, nav, footer,
  forms, dialogs and cookie banners. The injection fixture test proves seven hidden traps are removed.
- Extraction values are checked against the source: name and company must appear in the text or title, and email must
  appear literally (text or mailto). Anything else becomes null.
- Draft output checks (`findOutputProblem`): any URL other than the sender's own link, any email address, or any
  placeholder like `[First Name]` fails the draft, which triggers the one retry.
- The UI renders every field and draft as React text or form values. There is no `innerHTML`,
  `dangerouslySetInnerHTML` or markdown rendering anywhere in the source (checked by grep).

### Token budget and limiter

Assumed limits (Groq published base limits for gpt-oss-120b, per organisation): 30 RPM, 1,000 RPD, 8,000 TPM,
200,000 TPD. Tokens per minute is the tight one, so every call is kept small:

| Item | Cap |
|---|---|
| Page, selected or pasted text | 6,000 characters (`PAGE_TEXT_CAP`), about 1,500 tokens |
| Voice samples | at most 3, at most 1,500 characters each |
| Draft output | `AI_MAX_OUTPUT_TOKENS_DRAFT` 1,200 (includes hidden reasoning) |
| Extract output | `AI_MAX_OUTPUT_TOKENS_EXTRACT` 800 |
| Reasoning | `reasoning_effort: low`, `include_reasoning: false` |

A typical extract is about 2,500 to 3,000 tokens and a draft about 2,500 to 3,500, so with 8K TPM roughly two or three
AI calls fit in a minute across the whole organisation.

`AiLimiter` (`server/src/ai/limiter.ts`) is one in-process limiter shared by all users, sized by env below the
published limits (defaults: 25 RPM, 7,000 TPM, 950 RPD, 190,000 TPD). Each call reserves an estimate (characters / 4 +
20 + max output tokens) in a sliding 60 second window and a UTC day, waits up to `AI_LIMIT_MAX_WAIT_MS` (15 s) for room,
and otherwise fails with `AI_RATE_LIMITED` and the seconds to wait. After the call the reservation is settled to the real
`total_tokens`. **It is single instance**: run one server process, or move the counters to a shared store before
scaling out.

On a 429 from Groq the gateway reads `retry-after`, waits that long plus up to 1 s of jitter (if within the max wait),
retries once, and then returns `AI_RATE_LIMITED` with the seconds. Connection errors, timeouts (`AI_TIMEOUT_MS`, 30 s)
and 5xx retry once after 0.5 to 1.5 s, then return `AI_UNAVAILABLE`. Other errors return `AI_FAILED`. The SDK's own
retries are disabled so this is the only policy. Each call logs `{purpose, model, ms, prompt, completion, total}`
token counts, never content.

Per user daily caps: `DAILY_DRAFT_CAP` (100) and `DAILY_EXTRACT_CAP` (200), UTC days, with the unit refunded when the AI
call fails. A request per minute limit per user on AI routes (12) sits in front of both.

## 9. Export (.xlsx)

`GET /prospects/export` accepts the same `status` and `q` filters as the list, is authenticated, returns at most 5,000
newest rows, and writes one sheet named Prospects with the columns Name, Role, Company, Email, Status, Date added,
Source URL, Detail used, Draft subject and Draft body. The Draft body column is 100 characters wide, and the header row
has an autofilter. **SheetJS Community Edition cannot write frozen panes or cell styles (wrap text)**, so those two
formatting requests are not met. Line breaks inside the body are kept, and Excel shows them once wrap is turned on.

Formula injection: every cell is written as an explicit string cell (`t: 's'`), so nothing is evaluated. In addition,
`neutralizeCell` prefixes a single quote to any value that starts (or starts after leading spaces) with `=`, `+`, `-`,
`@`, tab, carriage return or line feed, or their full width (＝ ＋ － ＠) and small form (﹦ ﹢ ﹣ ﹫) variants, following
the OWASP CSV injection guidance. This protects users who later re-save the sheet as CSV. It is unit tested.

The panel downloads the file with an authenticated `fetch`, turns it into a blob, and clicks a temporary object URL
link. No `downloads` permission is needed.

## 10. Security and privacy controls (review against the brief)

| Rule | Where |
|---|---|
| Secrets only in server env, none in the bundle | `server/.env` (git ignored), build secret scan |
| helmet, HSTS, no `x-powered-by` | `app.ts` |
| HTTPS only in production | `app.ts` rejects `!req.secure` when `NODE_ENV=production`. Set `TRUST_PROXY_HOPS` behind a TLS proxy |
| Strict origin allowlist | Requests with any Origin other than `CORS_ORIGINS` get 403, and CORS headers are sent only for the extension |
| JSON body limit | 48 KB |
| Rate limits on every route | global per IP 600 per 15 min, per user 600 per 15 min, login 10 per 15 min per IP and per email, register 5 per hour, refresh 60 per 15 min, AI 12 per minute per user |
| zod on every input | shared schemas in every route, query strings included |
| Central error handler, no stack traces | `app.ts`. Unknown errors log the class and stack frames only (no message, which could echo data) |
| Env validated at boot, graceful shutdown | `env.ts`, `index.ts` |
| Logs never contain content | request logs keep method, path without query, status, timing and userId. pino `redact` as a backstop |
| Every prospect query scoped to the user | `services/prospects.ts`. Tested: user B cannot read, edit, delete, delete all or export user A's data |
| Messages validated | The injected result, the storage hand off and every API response are zod validated. The service worker's only `runtime.onMessage` listener accepts one message type (`op:collected`), only from this extension's own content script in a tab's top frame (`sender.id`, `sender.tab`, `frameId === 0`), only while collection is on, and only if it matches `CollectMessage` exactly. Web pages cannot message it (no `externally_connectable`) |
| Minimum permissions | section 5 |
| Data minimisation and disclosure | Panel empty state and Settings explain what is sent where, with no analytics. PRIVACY.md |
| Deletion | per prospect, delete all (`?confirm=all`), account deletion |

Retention: saved prospects and drafts are deleted 3 hours after they are first saved (`PROSPECT_TTL_HOURS`), or
earlier if the user deletes them. Accounts, settings and samples stay until the user deletes them. Sessions expire after
`REFRESH_TOKEN_TTL_DAYS` (30) and are TTL deleted. Usage counters are TTL deleted after 2 days. Page text is never
retained. In the browser, the work item is in session storage (gone when the browser closes), and Sign out clears it.

## 10b. Fault isolation: one failure does not take down the rest

Each dependency can fail on its own. What keeps working when it does:

| When this fails | Still works | What the user sees |
|---|---|---|
| **MongoDB (Atlas)** at boot or while running | The server starts and listens anyway and reconnects in the background (2 s backoff doubling to 30 s). Page reading, extraction for signed in users, health | Database routes answer at once with `503 DB_UNAVAILABLE` ("Saved data is unavailable for now ... Reading pages and extracting details still work") instead of hanging on the driver's server selection timeout |
| MongoDB fails **after** a draft was generated | The draft itself: `/draft` returns it with `prospect: null` | "Draft ready, but not saved", with copy buttons. Draft again later to save it |
| **Groq** unreachable at boot | The server still starts (3 tries, 10 s each). A definite "model missing" or "key rejected" still stops boot | Drafting shows "The AI step failed / not responding". Sign in, settings, the saved list and export are unaffected |
| **Groq** fails during extraction | The fields already found on the page (JSON-LD, title, mailto) stay and are editable | Error notice with Try again |
| **Daily cap counter** (database) | The AI call proceeds, logged as `usage_degraded`. The in process limiter still protects the Groq quota | Nothing |
| **Revocation check** (database) | A validly signed, unexpired access token (15 minutes) is accepted without the check, logged as `auth_degraded`. Invalid tokens are still refused | Nothing |
| **One panel section crashes** (render error, failed lazy load) | The other tabs. Each section has its own error boundary | "The Saved section stopped working" with Try again |
| **Clipboard** | Everything else | "Copy failed, select the text instead" |
| **Page read** throws unexpectedly in the service worker | Opening the panel and the hand off | "Couldn't read this page" with paste as a fallback |
| **Settings fetch** in the Prospect view | Drafting with default dials | Nothing |
| **Network** during a token refresh | The session (only a definite 401 signs out) | The request's own error |
| Side panel open in **several windows** | Each AI step runs once. A closed panel's abandoned step is recovered | Nothing |

`GET /health` reports each dependency separately: `{ ok, version, db: "up" | "down", ai: "up" | "unreachable" | "unchecked" }`.

Verified for real (not only mocked), 25 October 2026: the preview server's MongoDB process was killed while the panel
was in use. Health reported `db: down`, extraction still completed in about 1 s, the Saved tab showed the database
notice (and no false "no prospects yet"), and the Prospect tab stayed usable. The automated suite
`server/test/resilience.test.ts` (8 tests) covers the same cases by disconnecting the test database.

## 11. Every file

### Root

| File | Purpose |
|---|---|
| `package.json` | npm workspaces (`packages/shared`, `server`, `extension`), root scripts `build`, `test`, `typecheck`, `dev:*`, `zip`, and the approved `allowScripts` |
| `package-lock.json` | Committed lockfile |
| `tsconfig.base.json` | Strict TS settings shared by all packages, including the `source` custom condition |
| `.nvmrc` | Node 24 |
| `.gitignore` | Ignores node_modules, build output, `.env*` (except the examples and `extension/.env.development`) and `extension/keys/` |
| `README.md`, `DOCS.md`, `PRIVACY.md` | Docs |

**The `source` condition.** `@op/shared` exports `{ source: ./src/index.ts, default: ./dist/index.js }`. Vite, Vitest,
tsx (`--conditions=source`) and the type checker read the TypeScript source directly, so there is no build step during
development. The production server build compiles shared to `dist` and resolves the `default` entry.

### packages/shared (the API contract)

| File | Exports | Notes |
|---|---|---|
| `src/config.ts` | `APP_NAME`, `API_PREFIX`, `PAGE_TEXT_CAP`, `VOICE_SAMPLE_MAX_COUNT`, `VOICE_SAMPLE_MAX_CHARS`, `FIELD_LIMITS`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX` | The product name lives here and nowhere else (the manifest, UI and docs titles read it) |
| `src/schemas.ts` | zod schemas and types: `SourceMode`, `Tone`, `Length`, `Goal`, `ProspectStatus`, `Dials`, `DEFAULT_DIALS`, `Credentials`, `LoginRequest`, `RefreshRequest`, `AuthResponse`, `DeleteAccountRequest`, `SenderProfile`, `EMPTY_SENDER`, `isSenderProfileComplete`, `Settings`, `VoiceSampleCreate`, `VoiceSample`, `VoiceSampleList`, `ProspectFields`, `FIELD_KEYS`, `EMPTY_FIELDS`, `JsonLdEntity`, `PageSnapshot`, `ExtractRequest`, `FieldOrigin`, `ExtractResponse`, `DraftSource`, `DraftRequest`, `DraftOutput`, `Prospect`, `DraftResponse`, `ProspectFilter`, `ProspectListQuery`, `ProspectList`, `ProspectPatch`, `DeleteAllQuery`, `DeletedCount`, `ErrorCode`, `ErrorBody`, `Health`, `objectId` | `nullableText` trims and turns empty strings into null, so "unknown" has one representation. `nullableEmail` lowercases and validates. The sender `link` must be http(s) |
| `src/url.ts` | `normalizeUrl` | Section 6 |
| `src/url.test.ts` | | 6 tests |
| `src/index.ts` | re-exports | |

### server

| File | Purpose, exports, connections |
|---|---|
| `config/base-instructions.md` | The tracked base instructions with their version (section 8) |
| `.env.example` | Every environment variable with its default and an explanation |
| `src/env.ts` | `loadEnv()`, `Env`. A zod schema for the environment that fails boot with every problem listed. It also forbids `AI_SKIP_MODEL_CHECK` in production |
| `src/index.ts` | Boot: env, logger, base instructions, `verifyModel` (3 tries, tolerates an unreachable provider), limiter, gateway, `bufferCommands: false`, token and session services, `createApp`, listen, then `connectDatabase` in the background (retries, `syncIndexes` once connected), SIGINT and SIGTERM shutdown (10 s force exit) |
| `src/app.ts` | `createApp(ctx)`, `SERVER_VERSION`. Middleware order, `/api/v1` router, 404 and the central error handler that maps `ValidationError`, `AppError` and body parser errors to `ErrorBody` |
| `src/context.ts` | `AppContext`, the dependency bag passed to routes (no module level state) |
| `src/lib/dbStatus.ts` | `isDbConnected`, `isDbUnavailable` (classifies driver errors), `dbUnavailable` (the 503 error) |
| `src/lib/errors.ts` | `AppError(status, code, message, retryAfterSeconds?)`, `unauthenticated`, `notFound`, `invalidCredentials` |
| `src/lib/validate.ts` | `parse(schema, value)` throws `ValidationError` with per field issues |
| `src/lib/logger.ts` | `createLogger`, `httpLogger`. Serializers keep method, path without query, status and userId |
| `src/lib/rateLimits.ts` | `createRateLimits()` returns the limiter set (section 10). The handler returns `ErrorBody` with `retryAfterSeconds` and sets `Retry-After` |
| `src/db/models.ts` | Mongoose models `User`, `RefreshSession`, `VoiceSample`, `Prospect`, `UsageCounter`, the types `UserDoc` and `ProspectDoc`, and `syncIndexes()` |
| `src/auth/passwords.ts` | `hashPassword`, `verifyPassword` (argon2id, dummy hash for unknown users) |
| `src/auth/tokens.ts` | `TokenService` (`signAccess`, `verifyAccess`), `newRefreshToken`, `newFamilyId`, `hashToken` |
| `src/auth/sessions.ts` | `SessionService` (`start`, `refresh`, `revokeFamily`, `revokeByToken`, `isFamilyActive`). Rotation and reuse detection (section 7) |
| `src/auth/middleware.ts` | `requireAuth(tokens, sessions)` sets `req.userId`, and `userIdOf(req)` |
| `src/ai/provider.ts` | `AiProvider` interface, `OpenAiCompatibleProvider` (OpenAI SDK, `baseURL` from env, `maxRetries: 0`, timeout), `ProviderError` with kinds `rate_limited`, `transient`, `invalid_output`, `fatal`, and retry-after parsing |
| `src/ai/limiter.ts` | `AiLimiter` (`acquire`, `tryReserve`), `LimitExceededError`, `estimateTokens` |
| `src/ai/gateway.ts` | `AiGateway.completeJson(purpose, req)`: limiter, one retry with jitter, token usage logs, mapping to `AppError` |
| `src/ai/baseInstructions.ts` | `loadBaseInstructions`, `parseBaseInstructions` |
| `src/ai/prompts.ts` | `INJECTION_RULES`, `block`, `newNonce`, `buildDraftPrompt`, `EXTRACT_INSTRUCTIONS`, `buildExtractPrompt`, `EXTRACT_JSON_SCHEMA`, `DRAFT_JSON_SCHEMA` |
| `src/services/extract.ts` | `extractFields`, `verifyAgainstSource`, `safeJson` |
| `src/services/draft.ts` | `assertDraftable`, `generateDraft`, `findOutputProblem`, plus the footer append |
| `src/services/prospects.ts` | User scoped repository (every query also excludes expired prospects): `listProspects` (cursor), `prospectsForExport`, `getProspect`, `updateProspect`, `deleteProspect`, `deleteAllProspects`, `saveDraftedProspect` (upsert by normalized URL, sets `expiresAt` once), `toDto`, `EXPORT_ROW_LIMIT` |
| `src/services/spreadsheet.ts` | `neutralizeCell`, `EXPORT_COLUMNS`, `buildProspectWorkbook` |
| `src/services/usage.ts` | `consumeDaily`, `refundDaily` (atomic cap with a unique index) |
| `src/routes/auth.ts` | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| `src/routes/account.ts` | `/settings` GET and PUT, `/voice-samples` GET, POST and DELETE `/:id`, `DELETE /account`, plus the helpers `settingsOf` and `loadUser` |
| `src/routes/ai.ts` | `POST /extract`, `POST /draft` |
| `src/routes/prospects.ts` | `GET /prospects`, `GET /prospects/export` (registered before `/:id`), GET, PATCH and DELETE `/prospects/:id`, `DELETE /prospects?confirm=all` |
| `scripts/smoke-ai.ts` | Manual: verifies the model, runs one extraction and one draft against the real provider with fictional data, including an injection attempt. Not run by tests |
| `scripts/preview-server.ts` | Dev only: the real API on in-memory MongoDB with a canned stand-in for the AI (clearly labelled in its drafts), for clicking through the UI without Groq or Atlas |
| `test/helpers.ts` | `useMemoryMongo`, `FakeProvider` (scripted AI), `buildTestApp`, `testEnv` |
| `test/*.test.ts` | prompts (10), limiter and gateway (12), spreadsheet (21), output checks (6), sessions (7), API integration (44, including 6 retention and 9 collection tests), resilience (8) |

API summary (all under `/api/v1`, JSON, errors as `{ error: { code, message, retryAfterSeconds?, issues? } }`):

| Method and path | Auth | Body or query | Response |
|---|---|---|---|
| GET /health | no | | `{ ok, version, db, ai }` |
| POST /auth/register | no | `Credentials` | 201 `AuthResponse` |
| POST /auth/login | no | `LoginRequest` | `AuthResponse` |
| POST /auth/refresh | no | `RefreshRequest` | `AuthResponse` |
| POST /auth/logout | no | `RefreshRequest` | 204 |
| DELETE /account | yes | `DeleteAccountRequest` | 204 |
| GET, PUT /settings | yes | `Settings` | `Settings` |
| GET /voice-samples | yes | | `VoiceSampleList` |
| POST /voice-samples | yes | `VoiceSampleCreate` | 201 `VoiceSample` (409 when there are already 3) |
| DELETE /voice-samples/:id | yes | | 204 |
| POST /extract | yes | `ExtractRequest` | `ExtractResponse` |
| POST /draft | yes | `DraftRequest` | `DraftResponse` (409 `PROFILE_INCOMPLETE`; `prospect` is null if the draft could not be saved) |
| GET /prospects | yes | `ProspectListQuery` (cursor, limit, status, q) | `ProspectList` |
| GET /prospects/export | yes | `ProspectFilter` | .xlsx |
| GET, PATCH, DELETE /prospects/:id | yes | `ProspectPatch` for PATCH | `Prospect` or 204 |
| DELETE /prospects?confirm=all | yes | | `DeletedCount` |
| POST /prospects/collect | yes | `CollectRequest` (url, title, up to 50 `{ email, name }`) | 201 `CollectResponse` `{ added, alreadySaved }` |

### extension

| File | Purpose, exports, connections |
|---|---|
| `wxt.config.ts` | Manifest (name from `APP_NAME`, permissions, host permission from `WXT_API_BASE_URL`, action with no popup, `_execute_action` command, optional `key`, production CSP), Tailwind plugin, `source` condition, and the two build hooks |
| `build-checks.ts` | `findLoopbackPermissions`, `SECRET_PATTERNS`, `scanText`, `scanDirForSecrets` |
| `.env.development` | `WXT_API_BASE_URL=http://localhost:8787` for dev builds (committed, not secret) |
| `.env.example` | Template for `.env.production`: `WXT_API_BASE_URL`, `WXT_EXTENSION_KEY` |
| `scripts/gen-key.mjs` | Generates an RSA key, prints `WXT_EXTENSION_KEY`, the extension id and the matching `CORS_ORIGINS`, and writes the private key to `keys/` (git ignored) |
| `entrypoints/background.ts` | Service worker: context menus at install, `openPanelOnActionClick: false`, `action.onClicked` and `contextMenus.onClicked` call `openThenRead`, which calls `sidePanel.open` synchronously, then reads and writes `pendingRead` |
| `entrypoints/sidepanel/index.html`, `main.tsx`, `style.css` | Panel entry. `style.css` holds the design tokens (light and dark), focus ring, reduced motion and the one `settle` animation |
| `src/config.ts` | `API_BASE_URL`, **`BLOCKED_HOSTS` (the editable blocked host list)**, `RESTRICTED_HOSTS`, timeouts |
| `src/lib/pageReader.ts` | `readPageInjected(maxChars)`. The self contained injected reader (section 8) |
| `src/lib/reader.ts` | `ReadResult`, `ReadFailure`, `classifyUrl`, `readTab` (executeScript, main frame, validation, error mapping), `selectionResult` (context menu selection, no scripting) |
| `src/lib/collector.ts` | `collectPeople` (every visible address plus nearby name, at most 50), `mayCollect` (never collect rules) |
| `src/lib/autoCollect.ts` | `enableAutoCollect` (permission request plus runtime registration), `disableAutoCollect`, `syncAutoCollect`, `isAutoCollectOn`, `AUTO_KEY`, `AutoSetting` |
| `src/lib/messages.ts` | `CollectMessage`, the one message schema the service worker accepts |
| `src/lib/names.ts` | `PERSON_NAME`, kept free of zod so the content script stays small |
| `entrypoints/auto.content.ts` | The collector content script (runtime registered) |
| `src/lib/deterministic.ts` | `hintsFromSnapshot`: JSON-LD Person and Organization, title patterns ("Name - Role at Company"), role headings, and email only from a single mailto, a visible JSON-LD email, or the only address in the visible text. Values are clipped and validated per field |
| `src/lib/work.ts` | `WorkItem`, `PendingRead`, `WORK_KEY`, `PENDING_READ_KEY`. Loose field strings while editing, with `staleReason` |
| `src/lib/storage.ts` | `getStored`, `setStored`, `removeStored`, and the `useStored` React hook (zod validated, synced via `storage.onChanged`) |
| `src/lib/http.ts` | `httpRequest`, `ApiError`, `ClientErrorCode` (adds `OFFLINE`, `UNREACHABLE`, `TIMEOUT`, `BAD_RESPONSE`) |
| `src/lib/auth.ts` | `saveSession`, `clearSession`, `getAccessToken`, `refreshTokens` (Web Lock), `StoredAccess`, `StoredRefresh` |
| `src/lib/api.ts` | `api.*`, one typed function per endpoint, with 401 refresh and retry, one retry for GETs on network trouble, and the blob export |
| `src/lib/expiry.ts` | `useNow`, `formatLeft`, `formatClock`, `retentionLabel`, `EXPIRY_WARNING_MS` for the retention countdowns |
| `src/lib/useProspectFlow.ts` | The Prospect view state machine: consumes `pendingRead` (under a Web Lock, so with panels open in several windows exactly one takes it), `begin` (hints, then the work item, then extract), paste mode, interrupted reads, stale detection through `tabs.onActivated` and `tabs.onUpdated`, re-read, confirm, generate, save and clear. Each AI step holds a Web Lock named after the work item (`op-work-<id>`). Other panels queue for that lock, and if the item is still mid step when they get it, the panel that ran it closed, so the item is recovered (`interrupted` for extraction, back to review or drafted for drafting) |
| `src/App.tsx` | Auth gate (with session expired versus signed out), tabs, offline banner, and the lazy List and Settings views |
| `src/components/ui.tsx` | `Button`, `Field`, `Choice` (radio group drawn as a segmented control), `Banner`, `useCountdown`, `Spinner` |
| `src/components/ErrorBoundary.tsx` | `ErrorBoundary`, which contains a crash to one panel section |
| `src/components/ErrorNotice.tsx` | `ErrorNotice`, `toShown`, `ShownError`. Maps every error code to a message and one action, with a live countdown for rate limits |
| `src/views/SignInView.tsx` | Sign in and create account |
| `src/views/ProspectView.tsx` | Read notices, the stale banner, the empty state and privacy disclosure, paste box, fields with origin tags, dials, and the draft letter with the `detailUsed` margin note, copy and save |
| `src/views/ListView.tsx` | Search (debounced), status filter, status change, open (with a guard for unsaved changes), delete with inline confirm, show more, export, delete all |
| `src/views/SettingsView.tsx` | Sender profile, default dials, footer, voice samples with the reminder to remove personal details, privacy note, sign out, delete account |
| `public/icon/*.png` | Toolbar icons drawn in code (envelope mark) |
| `test/pageReader.test.ts` | The reader against fixtures `company`, `personal`, `investor`, `empty` and `injection`, plus truncation, no raw HTML, and text email hints |
| `test/reader.test.ts` | `classifyUrl`, `selectionResult`, build checks |
| `test/collector.test.ts` | The collector on a team page fixture (names, shared inboxes, hidden addresses, image names, the 50 cap), the never collect rules, the email picker |

## 12. Setup

1. **Node**: install Node 24 (`nvm use`). Then `npm install` at the root.
2. **Groq key**: create an API key at console.groq.com/keys. Check your organisation's limits at
   console.groq.com/settings/limits and adjust the `AI_LIMIT_*` values to stay below them.
3. **Enable Zero Data Retention in Groq Data Controls** (console.groq.com, Settings, Data Controls). Do this before
   real use. Groq is a processor named in PRIVACY.md.
4. **Check the model**: open console.groq.com/docs/deprecations and confirm `openai/gpt-oss-120b` is still listed as
   production and not deprecated. If not, pick the recommended replacement that supports strict structured output.
5. **MongoDB Atlas**: create a cluster (the free M0 is fine to start), a database user with read and write on one
   database, and network access for your server's IP. Copy the `mongodb+srv://` connection string, with a database name
   such as `outreach`. Indexes are created automatically at boot.
6. **Extension id**: `cd extension && node scripts/gen-key.mjs`. Put the printed `WXT_EXTENSION_KEY` in
   `extension/.env.development.local` (for dev) and `extension/.env.production`, and the printed origin in the server's
   `CORS_ORIGINS`. (If you skip this, Chrome derives the id from the folder path. Copy it from chrome://extensions into
   `CORS_ORIGINS`.)
7. **Server environment**: `cp server/.env.example server/.env` and fill in `MONGODB_URI`, `CORS_ORIGINS`, `JWT_SECRET`
   (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`), `AI_API_KEY` and `AI_MODEL`.
   Leave `ALLOW_SIGNUP` unset so only the first account can register.
8. **Run the server**: `npm run dev:server` (watch mode). For production: `npm run build`, then
   `NODE_ENV=production npm start -w server` behind HTTPS (set `TRUST_PROXY_HOPS=1` behind one TLS proxy).
   Optionally run `npm run smoke:ai -w server` once to see a real extraction and draft.
9. **Load the unpacked extension (dev)**: `npm run build:dev -w extension` (or `npm run dev:extension`
   for watch mode with hot reload). Open chrome://extensions, turn on Developer mode, click "Load unpacked", and
   choose `extension/.output/chrome-mv3-dev`. Pin the icon.
10. **Production build and zip**: create `extension/.env.production` with the https `WXT_API_BASE_URL` and
    `WXT_EXTENSION_KEY`, then `npm run build -w extension` (output `extension/.output/chrome-mv3`) and `npm run zip`
    (zip in `extension/.output/`). The build fails if the manifest references localhost or a secret pattern is found.
    After the first Web Store upload, the store assigns its own key and id. Copy the store's public key into
    `WXT_EXTENSION_KEY` and update `CORS_ORIGINS`.

**Extension environment mechanism.** WXT loads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local` from
`extension/` before reading `wxt.config.ts`. Only `WXT_*` variables reach the bundle through `import.meta.env`. Everything
there ships to users, so it must never contain secrets (the build scan enforces this).

**UI preview without Groq or Atlas**: build the dev extension, load it, copy its id, then
`CORS_ORIGINS=chrome-extension://<id> npm run preview -w server`. The drafts it produces are canned text and say so.

## 13. Testing

`npm test` runs everything (160 tests: shared 6, server 108, extension 46). `npm run typecheck` type checks all packages.
The AI is mocked in every automated test (`FakeProvider`). `npm run smoke:ai -w server` is the only script that calls
the real model, and it is never run automatically. Server integration tests use a real MongoDB in memory (the binary
downloads on first run).

What the automated tests prove: URL normalization, the page reader on all five fixtures (including seven kinds of hidden
injection text), deterministic extraction, prompt assembly and delimiter defanging, model output safety checks, the
limiter (RPM, TPM, daily, settle, wait or fail) and the gateway retry policy, formula neutralization and string cells,
refresh rotation, reuse detection, concurrent refresh, logout, the signup flag in all three states, identical login
failures, the login rate limit, the CORS rejection, the body limit, settings validation, the voice sample cap, extract
merge and verification, the draft profile requirement, footer, version stamp, URL dedupe, the paste no dedupe rule, the
daily cap with refund, cursor pagination, status filter, literal search, PATCH validation, export with filters, delete
one and all, cross user isolation for read, edit, delete, delete all and export, full account deletion, and retention
(the 3 hour stamp, the TTL index, the deadline kept on re-draft, expired prospects hidden at once, a fresh window after
expiry, and `PROSPECT_TTL_HOURS`).

Also verified in a real browser (Chromium 156 driving the panel): with four panels open, an extraction in one is not
mistaken for an interrupted one in the others (a race that let the AI result overwrite fields the user had typed was
found this way and fixed with the Web Locks above), and closing the panel mid extraction leaves the item recovered as
"interrupted" in the remaining panel.

### Manual QA checklist (you must test these by hand in real Chrome)

Gesture behaviour cannot be automated, so these checks are yours. Use the dev build against `npm run dev:server` (or the
preview server), and keep chrome://extensions open to read service worker errors.

Setup and auth

- [ ] Load unpacked, pin the icon. The manifest permissions shown are exactly: storage, activeTab, scripting, sidePanel,
      contextMenus, plus the API host.
- [ ] Create the first account, then try creating a second one: you see "Sign up is closed".
- [ ] Sign out and sign in. A wrong password and an unknown email show the same message.
- [ ] Settings: fill the sender profile and save. Add a voice sample, and check a 4th cannot be added.

Reading with a gesture (the core activeTab behaviour)

- [ ] On a real company or investor page, **click the toolbar icon**: the panel opens and the fields fill in within a
      few seconds.
- [ ] Close the panel, go to another normal page and press **Alt+Shift+O**: the same happens.
- [ ] **Right click the page, then "Draft outreach for this page"**: the same happens.
- [ ] **Select a paragraph, right click, then "Draft outreach from selected text"**: the source line shows "selected
      text".
- [ ] Right after a gesture read, click **Re-read**: it works (the grant is still live).
- [ ] Navigate that tab to a different site, then click **Re-read** in the panel without clicking the icon. You should
      see "Click the extension icon on the page first". Record what you see. Expected per Chrome docs: refused, because
      the grant ended with the cross origin navigation.
- [ ] Open a brand new tab with a normal site (never clicked) and press Re-read in the panel: the same message.

Blocked and restricted pages

- [ ] On linkedin.com, click the icon: no read happens, and the panel explains why and offers selected text or paste.
      Selecting text there and using the selection menu item works.
- [ ] On chrome://extensions, the Chrome Web Store and a PDF: you see "Chrome doesn't allow reading this page".
- [ ] On a blank or login page: "Nothing readable here".

Stale page protection

- [ ] After a read, switch to another tab: the "You switched to another tab" banner appears and Draft is disabled.
      Switch back and it clears.
- [ ] After a read, navigate the same tab: you see "This page has changed". Choose "Keep working on this one" or "Read
      the current page".

Drafting, saving, export

- [ ] Confirm the fields, choose dials and draft. The margin note names a detail that really is on the page. Copy subject
      and Copy body work (paste into your mail client).
- [ ] Edit the body, then close and reopen the panel: the edit is still there. Save changes, and the Saved tab shows it.
- [ ] Draft the same page again: the Saved list still has one entry for it.
- [ ] Saved: search, filter by status, change a status, open an item, delete one, export (.xlsx opens in Excel, Numbers
      or Sheets with the Draft body column wide).
- [ ] Retention: start the server with `PROSPECT_TTL_HOURS=0.25`, draft once. The draft says "Saved until" a time 15
      minutes ahead, the Saved tab shows a warning and "Deleted in 15 min". After 15 minutes the prospect is gone from the
      list and Open shows the "export earlier" message.
- [ ] Automatic collection: in Settings, turn it on and accept Chrome's prompt. Open a fund's team page: the icon shows
      a number and the Saved tab's "New" filter lists the people. Open linkedin.com, your webmail and a sign in page:
      no number appears. Turn it off: chrome://extensions shows the site access removed.
- [ ] One click mode on a page with several addresses: the Email field lists them, with "likely match" on the right one.
- [ ] Open the side panel in two Chrome windows and read a page in one: the other shows the same work and neither
      marks it interrupted.

Error states

- [ ] Stop the server and draft: you see "Can't reach the server". Turn off the network: you see "You're offline".
- [ ] Set `AI_LIMIT_RPM=1` and draft twice quickly: you see "Busy right now" with a countdown.
- [ ] Set `DAILY_DRAFT_CAP=1`: the second draft shows "Daily limit reached".
- [ ] Set `ACCESS_TOKEN_TTL_SECONDS=60` and wait 2 minutes: requests keep working (silent refresh). Revoke the session by
      deleting it in the database: you return to sign in with "Your session expired".

Accessibility and appearance

- [ ] Resize the panel to its narrowest: no horizontal scrolling.
- [ ] Switch the OS to dark mode: the panel follows.
- [ ] Use only the keyboard (Tab, Shift+Tab, arrow keys in the dial groups, Enter and Space): every control is reachable,
      with a visible focus ring.
- [ ] Turn on reduced motion in the OS: the draft appears without animation.

## 14. Default decisions made (the brief was silent)

| Decision | Default | Where to change |
|---|---|---|
| Model | `openai/gpt-oss-120b`, reasoning effort low | `AI_MODEL`, `AI_REASONING_EFFORT` |
| Output token caps | draft 1,200, extract 800 | `AI_MAX_OUTPUT_TOKENS_*` |
| Limiter | 25 RPM, 7,000 TPM, 950 RPD, 190,000 TPD, 15 s max wait | `AI_LIMIT_*` |
| Daily caps | 100 drafts, 200 extracts per user per UTC day | `DAILY_DRAFT_CAP`, `DAILY_EXTRACT_CAP` |
| Prospect retention | 3 hours from first save, not extended by edits | `PROSPECT_TTL_HOURS` (0.25 to 720) |
| Access and refresh lifetimes | 15 minutes, 30 days | `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` |
| Signup | open until the first account exists | `ALLOW_SIGNUP` |
| Password rule | 10 to 200 characters | `Credentials` in shared schemas |
| Keyboard shortcut | Alt+Shift+O | `wxt.config.ts`, or the user at chrome://extensions/shortcuts |
| Default dials | warm, short, book a call | `DEFAULT_DIALS`, or per user in Settings |
| Sender profile required fields | name, organisation, offer | `isSenderProfileComplete` |
| Draft requirements | (name or company) and (detail or bio) | `assertDraftable` |
| Export row cap | 5,000 newest (in practice far fewer, given 3 hour retention) | `EXPORT_ROW_LIMIT` |
| Page size | 25, max 100 | `PAGE_SIZE_*` |
| Deleting all prospects | requires `?confirm=all` and an inline confirm | ListView, prospects route |
| Account deletion | requires the password | `DELETE /account` |
| Pasted text | never deduplicated (no URL) | `saveDraftedProspect` |
| Re-drafting a saved page | resets its status to drafted | `saveDraftedProspect` |
| Selected text on blocked hosts | allowed (the user chose the text, and the page is not scripted) | `selectionResult` |
| Blocked hosts | `linkedin.com` and subdomains | `extension/src/config.ts` `BLOCKED_HOSTS` |
| Automatic collection | off. When on, never on `NEVER_COLLECT_HOSTS`, private networks, password, card or code pages. 50 people per page. 60 pages per minute | `extension/src/config.ts`, `COLLECT_MAX_PEOPLE`, `rateLimits.ts` |

**Blocked host decision.** LinkedIn's help pages say third party extensions that scrape or automate its pages are not
permitted and can lead to account restrictions, even when used on click. So on `linkedin.com` (and subdomains) the
extension never injects the reader. It explains why and offers the two modes that do not script the page: text the
user selects (Chrome passes the selection to the context menu handler) and pasted text. The list is one array in
`extension/src/config.ts`, and adding a host there disables page reading on it.

## 15. Known limits

- **Gesture paths are verified only by hand** (section 4). The refusal path was observed in Chrome 156.
- **Collected names are heuristic.** The name is the link text or the name line in the same card. Unusual layouts can
  give no name or, rarely, a wrong one. Only the email is certain. Single page apps are scanned at load and once 4 s later,
  not on later in page navigation.
- **Retention is a hard delete.** There is no recycle bin. If a user forgets to export, the drafts are gone, and the
  panel's countdown and warning are the only reminder (there are no notifications or emails).
- **IPv6 to Groq**: on the development machine (25 October 2026) IPv6 to api.groq.com did not connect and IPv4 was slow
  at times (3 to 7 s to connect). Node falls back to IPv4 by itself. If AI calls time out, check the network first.
- **Single instance limits**: the AI limiter and the express-rate-limit counters are in memory. Run one server process,
  or move both to Redis before scaling out.
- **SPA navigation**: stale detection relies on `tabs.onUpdated` (`status: 'loading'` or a URL change). Some
  single page apps change their URL without either event being visible to the extension (no `tabs` permission), so the
  banner may not appear. Re-read before drafting on such sites.
- **Hidden text detection** covers the common techniques (section 8) but not every trick, such as text the same colour
  as its background, or text covered by another element. The prompt defences and the user's review are the backstop.
- **Iframes and shadow DOM** are not read (main frame and light DOM only).
- **Search** is a case insensitive regex scan inside one user's prospects. That is fine for thousands of prospects. For
  much larger lists, add a text or Atlas Search index.
- **Export formatting**: no frozen header row and no wrap style (SheetJS CE limitation).
- **Voice sample cap** check then insert is not atomic, so two simultaneous adds could briefly give 4 samples.
- **Refresh token in local storage**: readable by any extension context of this extension. The extension has no
  persistent content scripts, and the injected reader is self contained and never touches chrome APIs.
- **The extension name** is a working title, set by `APP_NAME` in `packages/shared/src/config.ts`.
- **PRIVACY.md is a draft** and needs legal review and the operator's details.
