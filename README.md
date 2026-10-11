# Verse Studio

A personal content studio for a Christian Instagram account. It makes daily Bible-verse reels and quote carousels automatically, and turns uploaded phone clips into captioned reels from a plain-language request. Every video comes with a caption, five hashtags, and up to four sound versions (original sound, library music, her own music, no music).

- **Website** (`apps/web`, hosted on Vercel): sign in with Google from any phone or computer, upload clips, ask for reels, change settings, download finished videos.
- **Worker** (`apps/worker`, runs on an always-on Windows PC or Mac): picks up requests from Google Drive, plans content with **Claude Code logged in to her Claude Pro/Max plan** (no API key), renders with Remotion and ffmpeg, transcribes with whisper.cpp, and uploads the results back to Drive.
- **Google Drive** is the only connection between the two. No database, no server, no open ports.

Setup takes about 45 minutes: see **[docs/SETUP.md](docs/SETUP.md)**.

## What it makes

| | How |
|---|---|
| Verse reels (9:16) | Claude picks verses that haven't been used recently and writes the hook, caption and hashtags. English verse text comes word-for-word from a public-domain Bible. Six looks: Dawn, Night sky, Paper, Bold, Garden, and her own background clips or photos. Signature and a closing "follow" card included. |
| Edited reels from uploads | Clips are normalised, transcribed, and shown to Claude as frame grids. Claude plans the cuts around her request, cutting on pauses rather than mid-line. The render adds word-by-word captions (English or Telugu), a hook card, a signature and an outro. |
| Carousels (4:5) | Cover, body slides and a call-to-action slide, with exact scripture inserted, as PNGs ready to post. |
| Auto mode | N reels per day and N carousels per week at a set time, mixed English/Telugu, with optional approval before they show as ready. |

## Commands (repo root)

```bash
npm install          # once
npm run login        # sign the worker in to Google Drive
npm run doctor       # check everything
npm run worker       # run the worker in the foreground
npm run web          # website on http://localhost:5173 (needs apps/web/.env.local)
npm run demo -w apps/worker   # offline test: renders sample reels, a carousel and an edit into ./demo-output
```

## Layout

```
shared/schema.ts           settings, job and output formats shared by both sides
apps/web/                  website (Vite + React), talks straight to Google Drive
apps/worker/src/           worker loop, Drive client, Claude Code runner, ffmpeg, whisper
apps/worker/remotion/      video templates: VerseReel, Slide, ClipEdit
scripts/                   Windows and macOS installers
```
