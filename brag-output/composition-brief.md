# Hyperframes Composition Brief: Outreach Personalizer

## Objective
A 40 s narrated launch film for Outreach Personalizer (British male voice, user requested).

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080, 30 fps
- Duration: 40.0 s (user override of brag's 15-25 s)

## Source Material
- Project root: `/home/stein/Desktop/myprojects/outreach-personalizer`
- Files read: `extension/src/views/EmailsView.tsx`, `SettingsView.tsx`, `SignInView.tsx`, `entrypoints/sidepanel/style.css`,
  `packages/shared/src/config.ts`, `server/config/base-instructions.md`, `DOCS.md`
- Product name: Outreach Personalizer
- Strongest claim: saves itself to Downloads/Outreach Personalizer at 200 emails, then a new sheet starts
- UI to recreate: the Sheets card (title "Sheet N", "N of 200 emails", progress bar, "Download now and start a new
  sheet"), the "Write a message (optional)" composer with Tone/Length and "Draft for sheet 2 (50 emails)", the letter
  preview, the panel banner "9 new emails saved", the Settings button "Turn on automatic collection"
- Copy verbatim from the product: "Sheet 1", "of 200 emails", "9 new emails saved", "Turn on automatic collection",
  "Write a message (optional)", "What do you want to say?", "Draft for sheet 2", "Hi there,",
  "If this isn't relevant, just reply and I won't follow up.", "Outreach Personalizer"

## Creative Direction
- Tone preset: polished; direction: dry British documentary narrator, quiet competent tool
- Hook: addresses in search snippets split into highlighted pieces, pulling apart on the word "pieces"
- Outro: "Outreach Personalizer. You browse. It keeps the list."
- Avoid: generic SaaS language, abstract filler, real addresses or brands (all fictional `.example`), any search engine logo

## Visual Identity
- Ground #f2f4f7, surface #ffffff, sheet #fbfcfd, ink #18233a, soft ink #4a5672, rule #d5dbe5,
  accent #0f7a64, accent soft #e3f3ee
- Inter (UI and titles, standing in for the product's system sans), EB Garamond (the letter, standing in for Charter)

## Storyboard
See `brag-plan.md`. Scenes: Plain sight 6.5 s, One click 7.2 s, Keep browsing 7.2 s, It saves itself 6.1 s,
Say it once 7.5 s, Outro 5.5 s = 40.0 s.

## Audio
- Voice: six Kokoro `bm_george` clips (`assets/vo/vo1-6.wav`), one per scene, starting 0.15-0.3 s into each scene
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, 0.14 under voice, lifting to ~0.3 for
  the final hold, fade out at the end
- Cue lock: the `sheet-001.xlsx` drop at 22.93 s (strong cue)
- SFX: icon click (ui/mouseclick1), panel land (interface/drop_002), sheet saved (impact/impactBell_heavy_000, soft),
  Draft click (ui/click3). Sparse, never on a key word.
- Audio-reactive: none (documented choice for the restrained tone)

## Hyperframes Instructions
Build with the Hyperframes contract: one sub-composition per scene, `fromTo` tweens, registered paused timelines,
root-relative asset paths, `check` as the gate. Keep everything local.
