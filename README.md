# Outreach Personalizer

A Chrome (and Brave) extension with a small API. It collects the email addresses on pages you visit, saves them into
spreadsheets of 200 in your Downloads folder by itself, and, if you want, drafts one message for a sheet from what you
type.

Everything else (setup, how it works, every file, the manual checks) is in [DOCS.md](DOCS.md). Privacy draft:
[PRIVACY.md](PRIVACY.md).

```bash
npm install
npm test
npm run dev:server              # needs server/.env, see DOCS.md
npm run build:dev -w extension  # then load extension/.output/chrome-mv3-dev unpacked
```
