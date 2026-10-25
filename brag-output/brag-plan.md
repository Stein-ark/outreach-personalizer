# Brag Plan: Outreach Personalizer

## What is this app?
A Chrome and Brave extension that picks up every email address on the pages you browse, files them into spreadsheets of
200 that save themselves to your Downloads folder, and can draft one message for a whole sheet.

## The angle
A calm British narrator walks through a quiet, tidy power tool. The hook is a real bug turned into a feature: search
results show addresses in plain sight, but split them into pieces (highlighted words), and this extension puts them back
together. Everything after that is the product getting on with it while you browse.

## Hook (first 2-3 seconds)
A search results page with addresses visible in the snippets. On "Google even chops them into pieces", the bold
highlighted fragments of each address visibly pull apart.

## Key moments (the middle)
- The fragments snap back together into whole addresses, the side panel opens: "9 new emails saved", the icon badge reads 9.
- Automatic collection switches on; pages flick past; the Sheets card counts up toward 200.
- The bar hits 200 of 200; `sheet-001.xlsx` drops into Downloads/Outreach Personalizer; Sheet 2 starts at 0.
- "What do you want to say?" types itself; Draft for sheet 2; the letter appears with "Hi there," and the opt-out line.

## Outro / punchline
"Outreach Personalizer. You browse. It keeps the list." Name, then the two short lines, then hold.

## User flow worth showing
Browse a page with addresses → click the icon (or let automatic collection run) → the sheet fills and saves itself →
optionally type a message and draft it for the sheet.

## Tone
- Preset: polished
- Creative direction: dry British documentary narrator; a quiet, competent tool, gently pleased with itself
- Interpretation: restrained motion, long tidy holds, one idea per scene, small wry lines in the voice only

## Format: landscape — 1920x1080
## Duration: 40 s (the user asked for 40 s with a voiceover, overriding brag's 15-25 s window)

## Visual identity (from the project, `extension/entrypoints/sidepanel/style.css`)
- Background (paper): #f2f4f7; surface #ffffff; sheet #fbfcfd
- Text (ink): #18233a; soft ink #4a5672; rules #d5dbe5
- Accent (action, verdigris): #0f7a64; action soft #e3f3ee
- Display and UI font: the product uses the system sans; Inter (bundled) stands in
- Letter font: the product's draft uses Charter; EB Garamond (bundled) stands in
- Strongest visual element: the Sheets card with its progress bar, and the draft set as a letter

## Privacy substitutions
The real test page held real businesses' addresses. Every address, business and page in the video is fictional,
using the reserved `.example` domain. No real names, addresses or URLs appear.

## Share copy (draft)
Outreach Personalizer: browse as usual, and every email address on the page lands in a spreadsheet of 200 that saves
itself. Drafting a message for the sheet is optional.

## Audio direction
- Role: narration first, warm bed underneath
- Music: happy-beats-business-moves-vol-12 (steady, clean), ducked to 0.14 under the voice, up to 0.32 for the final hold
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (110 BPM). Lock the `sheet-001.xlsx` drop to the strong cue at 22.93 s.
- Audio-reactive treatment: none (the voice carries it; the look is restrained)
- SFX posture: sparse, motion matched: a click on the icon click, a soft drop as the panel/badge lands, a single bell on
  the sheet saving, a click on Draft. Nothing on every email.
- Restraint rule: no SFX over a spoken key word; music never above 0.35

## Voiceover script (Kokoro `bm_george`, British male, speed 1.06)
1. Search results hide email addresses in plain sight. Google even chops them into pieces. (5.99 s)
2. One click on the icon, and Outreach Personalizer stitches them back together. Nine found. Nine saved. (6.89 s)
3. Switch on automatic collection, and just keep browsing. Every address lands in a sheet, two hundred to a sheet. (6.93 s)
4. When a sheet fills up, it saves itself to your Downloads folder, and quietly starts the next one. (5.93 s)
5. Fancy saying something? Write it once. The A.I. drafts one message for the whole sheet, opt-out line included. (7.21 s)
6. Outreach Personalizer. You browse. It keeps the list. (3.58 s)

Grounding: nine addresses (the real test page), 200 per sheet, saves itself to Downloads, one message per sheet,
opt-out line, automatic collection, the icon click: all from the product. "Google even chops them into pieces" is the
real cause of the bug fixed in this project.

## Storyboard (voice is the clock; times are absolute)

### Scene 1 — Plain sight — 0.0-6.5 s
A results page in a browser frame: four results, each snippet holding an address with bold highlighted fragments.
Sequential: results settle in one by one; at 2.8 s ("Google even chops them") the bold fragments of each address drift
apart slightly. Audio: bed enters softly. Transition: blur swap → Scene 2.

### Scene 2 — One click — 6.5-13.7 s
Same browser; a cursor clicks the toolbar icon at ~7.3 s (click). On "stitches them back together" (~8.3-11 s) the
fragments snap together and each whole address gets a verdigris underline. The side panel slides in; badge "9" lands on
"Nine found" (~11.4 s); banner "9 new emails saved" on "Nine saved" (~12.6 s). Transition: slide.

### Scene 3 — Keep browsing — 13.7-20.9 s
Side panel Settings: "Turn on automatic collection" flips on at ~14.9 s. Page thumbnails flick past behind it on
"just keep browsing"; the Sheets card counts 9 → 187 with the bar filling, "of 200" emphasised on "two hundred".

### Scene 4 — It saves itself — 20.9-27.0 s
The bar completes 200 of 200 on "fills up" (~21.2 s). A file card `sheet-001.xlsx` drops into a "Downloads / Outreach
Personalizer" folder at 22.93 s (beat-locked, bell). On "starts the next one" the card resets: Sheet 2, 0 of 200.

### Scene 5 — Say it once — 27.0-34.5 s
The composer: "What do you want to say?" types a short line on "Write it once"; Tone Friendly, Length Short; the cursor
clicks "Draft for sheet 2" (~29.9 s, click). The letter appears ("Hi there," ... ), and on "opt-out line included"
(~33 s) the line "If this isn't relevant, just reply and I won't follow up." gets a verdigris highlight.

### Scene 6 — Outro — 34.5-40.0 s
Paper ground. "Outreach Personalizer" lands at 34.7 s; "You browse." at 36.6 s; "It keeps the list." at 37.4 s. Hold to
40.0 s; music lifts slightly and fades under the end.

**Music mood:** steady, clean, warm. **Audio summary:** a quiet bed under a dry British voice, with four small sounds
where something visibly happens and one bell when the sheet saves.
