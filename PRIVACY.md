# Outreach Personalizer privacy policy (DRAFT)

> **Draft, not legal advice.** This text was written by the developer to describe how the software behaves. It needs
> review by a qualified lawyer before the extension is published, and the operator details in brackets must be filled in.

Operator: [your name or company], [contact email], [postal address]. Last updated: 25 October 2026.

## What the extension does

Outreach Personalizer collects email addresses that are visible on web pages and saves them into spreadsheets of 200 in
your Downloads folder. If you ask it to, it drafts one message for a spreadsheet from what you type. It never sends
email.

It looks for addresses on a page when you click its icon, choose "Collect emails on this page" from the right click
menu, or press its shortcut. If you turn on **automatic collection** in Settings (Chrome then asks for access to all
websites), it also looks on every page you open. It never runs on LinkedIn, webmail, Google Docs, Drive or Calendar,
the messaging and payment sites listed in the extension, private network addresses, or any page with a password, card
or one time code field. Turning automatic collection off, signing out or deleting your account stops it and removes the
website access.

## What is collected, and why

| Data | When | Why |
|---|---|---|
| Your email address and a hashed password (argon2id) | When you create an account | To sign you in and keep your data separate |
| Your name and an optional link | When you save Settings | To sign the messages you draft |
| Email addresses visible on pages, with the page's address and title | When you click the icon, or on every page while automatic collection is on | To build your spreadsheets. **The rest of the page is never collected or sent.** |
| What you type when you draft a message, and the drafted message | When you click Draft | To write the message. What you type is sent to Groq for that |
| Technical logs: time, request path, status, timing, your account id, AI token counts | Each request | Security and reliability. Logs never contain addresses, messages, passwords or tokens |

The extension keeps your sign in tokens, the numbers of the sheets already downloaded, the last message you typed and
the result of your last click in your browser's extension storage. There are no analytics, advertising or trackers,
and data is never sold or shared for any other purpose.

## Where data goes (processors)

- **[Hosting provider]**, which runs the Outreach Personalizer server, in [region].
- **MongoDB Atlas (MongoDB, Inc.)**, the database, in [region and cloud provider].
- **Groq, Inc.**, the AI provider, only when you draft a message. It receives what you typed, your name and your link,
  never any collected address. Groq states that it does not retain inference data by default apart from temporary
  abuse and reliability logs. The operator has enabled Zero Data Retention in Groq's Data Controls [confirm].

## Retention

- Collected addresses and drafts are deleted from the server automatically **3 hours** after they are saved. Before
  that, the extension saves them to your Downloads folder in spreadsheets, which stay on your device under your control.
- Accounts and settings are kept until you delete them or your account.
- Sign in sessions expire after 30 days. Daily usage counters are removed after 2 days.
- Server logs are kept for [N] days by [hosting provider].

## Your choices and rights

You can delete any saved address, delete all of them, and delete your account, which immediately deletes everything
tied to it from the database. Database backups held by [MongoDB Atlas backup policy] expire within [N] days. For any
other request (access, correction, objection, complaint), contact [contact email]. You may also complain to your data
protection authority.

## The people whose addresses you collect

Collected addresses are personal data about other people. You are responsible for having a lawful reason to contact
them and for following anti spam and marketing laws where you and they are located, for example GDPR and PECR in the EU
and UK and CAN-SPAM in the US, which restricts sending commercial email to harvested addresses. Drafted messages include
a line inviting the recipient to opt out; honour those requests.

## Children

The extension is not intended for anyone under 18.

## Changes

Material changes to this policy will be announced in the extension before they take effect.
