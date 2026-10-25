# Outreach Personalizer

A Chrome extension (side panel) plus a small API that drafts a personalized fundraising outreach email from the page
you are viewing, when you ask it to. It reads only the page you choose, saves prospects to a list, and exports them to
.xlsx with the draft in its own column.

Everything you need (setup, architecture, every file, the manual QA checklist) is in [DOCS.md](DOCS.md).
Privacy draft: [PRIVACY.md](PRIVACY.md).

```bash
npm install
npm test
npm run dev:server      # needs server/.env, see DOCS.md
npm run dev:extension   # or: npm run build -w extension -- --mode development
```
