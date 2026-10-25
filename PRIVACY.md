# Outreach Personalizer privacy policy (DRAFT)

> **Draft, not legal advice.** This text was written by the developer to describe how the software behaves. It needs
> review by a qualified lawyer before the extension is published, and the operator details in brackets must be filled in.

Operator: [your name or company], [contact email], [postal address]. Last updated: 25 October 2026.

## What the extension does

Outreach Personalizer helps you write a personal outreach email to someone whose web page you are viewing. It reads
the page you are on only when you ask it to (by clicking its toolbar icon, choosing one of its right click menu items,
or pressing its keyboard shortcut). It never reads pages in the background, never follows links, never collects
lists of people, and never sends email.

## What is collected, and why

| Data | When | Why |
|---|---|---|
| Your email address and a hashed password (argon2id) | When you create an account | To sign you in and keep your data separate from other users |
| Your sender profile (name, role, organisation, what you offer, optional link), default settings and optional footer | When you save settings | To write drafts in your name without inventing facts about you |
| Up to 3 sample emails you wrote | When you add them | To match your writing style. You are asked to remove other people's details first |
| Text from the page you chose, text you selected, or text you pasted (at most 6,000 characters) | Each time you ask the extension to read | To extract the prospect's details and write the draft. **This text is processed and then discarded. It is never stored on our server or in the extension.** |
| Prospect details you confirm (name, role, company, short bio, one notable detail, an email address only if it appeared on the page), the page address and title, the draft subject and body, and its status | When a draft is generated or you edit it | To keep your list of prospects and let you export it |
| Technical logs: time, request path, status code, response time, your account id, and AI token counts | On each request | Security, abuse prevention and reliability. Logs never contain page text, prospect details, drafts, passwords or tokens |

The extension stores your sign in tokens in Chrome's extension storage on your device, and keeps your current, unsaved
prospect in Chrome's session storage (memory only, cleared when the browser closes).

There are no analytics, no advertising, no trackers and no third party scripts. Data is never sold, rented or shared
for any purpose other than providing the features above.

## Where data goes (processors)

- **[Hosting provider]**, which runs the Outreach Personalizer server, in [region].
- **MongoDB Atlas (MongoDB, Inc.)**, which hosts the database, in [region and cloud provider]. It stores accounts,
  settings, voice samples and saved prospects.
- **Groq, Inc.**, the AI provider. When you ask for extraction or a draft, the text described above is sent to Groq to
  produce the result. Groq states that it does not retain inference data by default, apart from temporary logs kept for
  abuse monitoring and reliability. The operator has enabled Zero Data Retention in Groq's Data Controls [confirm].

## Retention

- Accounts, settings and voice samples are kept until you delete them or delete your account.
- Saved prospects are kept until you delete them (one at a time or all at once) or delete your account.
- Sign in sessions expire after 30 days and are then removed automatically.
- Daily usage counters are removed automatically after two days.
- Server logs are kept for [N] days by [hosting provider].
- Page, selected and pasted text is not retained.

## Your choices and rights

In the extension you can edit or delete any saved prospect, delete all prospects, remove voice samples, and delete
your account, which immediately deletes all data tied to it from the database. Database backups held by
[MongoDB Atlas backup policy] expire within [N] days. To exercise any other right (access, correction, objection,
complaint), contact [contact email]. Depending on where you live you may also complain to your data protection authority.

## Personal data of the people you research

Prospect details are personal data about other people. You are responsible for having a lawful reason to contact
them, for following anti spam and marketing laws where you and they are located, and for honouring opt out requests.
The extension avoids sites whose terms forbid extension access (for example LinkedIn) and only uses an email address
that is published on the page you chose.

## Children

The extension is not intended for anyone under 18.

## Changes

Material changes to this policy will be announced in the extension before they take effect.
