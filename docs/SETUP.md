# Verse Studio setup

About 45 minutes, done once. You need:

- The always-on Windows PC (or a Mac)
- Her Google account (the one whose Drive will hold the videos)
- Her Claude Pro or Max subscription
- A GitHub account and a free Vercel account

How the pieces fit:

```
 Phone / any browser                 Google Drive ("Verse Studio" folder)            Always-on PC
 ┌──────────────────┐   uploads,    ┌─────────────────────────────────────┐  polls  ┌──────────────────────────┐
 │ Website (Vercel) │ ─ requests ─▶ │ Jobs/  Uploads/  Output/  Music/ … │ ◀─────▶ │ Worker                    │
 │ sign in w/ Google│ ◀─ videos ─── │ settings.json  State/worker.json    │  files  │  Claude Code (her plan)   │
 └──────────────────┘               └─────────────────────────────────────┘         │  Remotion + ffmpeg render │
                                                                                     │  whisper.cpp captions     │
                                                                                     └──────────────────────────┘
```

The website never touches the PC directly. Both sides read and write the same Drive folder, so uploads work from anywhere and the PC can sit behind a home router with no open ports.

---

## 1. Put the code on GitHub

Create a private repository (for example `verse-studio`) and push this folder to it. If you received the code as a zip:

```bash
cd verse-studio
git init
git add .
git commit -m "Verse Studio"
git branch -M main
git remote add origin https://github.com/<you>/verse-studio.git
git push -u origin main
```

## 2. Google Cloud: one project, two sign-in clients

1. Go to <https://console.cloud.google.com/>, signed in as **her** Google account. Create a project called **Verse Studio**.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type **External**. App name "Verse Studio", support email = her email.
   - Scopes (Data access): add `.../auth/drive.file`, `openid`, `email`, `profile`. These are all non-sensitive, so no Google review is needed.
   - **Audience → Publish app** so the status is **In production**. This matters: in "Testing" status Google expires the PC's sign-in every 7 days and auto mode would stop.
4. **Credentials → Create credentials → OAuth client ID**, twice:
   - **Web application**, name "Website". Authorised JavaScript origins: `http://localhost:5173` now, and the Vercel address after step 3 (e.g. `https://verse-studio-xyz.vercel.app`). Copy the **Client ID**.
   - **Desktop app**, name "Worker". Copy the **Client ID** and **Client secret**.

`drive.file` means the app can only see files it created itself, never the rest of her Drive. Both clients belong to the same project, so the website and the PC see the same files.

## 3. Website on Vercel

1. <https://vercel.com/new> → import the GitHub repository.
2. **Root Directory**: `apps/web`. Framework preset: Vite (detected automatically).
3. **Environment variables**:
   - `VITE_GOOGLE_CLIENT_ID` = the **Website** client ID from step 2
   - `VITE_ALLOWED_EMAILS` = her Gmail address (optional, but recommended: only this account can open the studio)
4. Deploy. Copy the address Vercel gives you and add it to the Website client's **Authorised JavaScript origins** (step 2). Changes there can take a few minutes to apply.

Open the site, sign in with her Google account. It creates the **Verse Studio** folder in her Drive and shows "Studio computer not set up yet".

## 4. The always-on PC (Windows)

1. Install **Git for Windows** from <https://git-scm.com/downloads/win> (accept the defaults).
2. Open **PowerShell** and run:

   ```powershell
   cd $HOME
   git clone https://github.com/<you>/verse-studio.git
   cd verse-studio
   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
   ```

The script installs Node.js and Claude Code if they're missing, installs the packages, then walks through:

- **Google credentials**: Notepad opens `apps\worker\.env`. Paste the **Desktop** client ID and secret, save, close.
- **Claude login**: Claude opens in the terminal. Choose to log in with a **Claude account** (Pro/Max), finish in the browser, then type `/exit`. This uses her subscription. No API key is involved.
- **Google sign-in**: a browser tab opens. Sign in with **the same Google account** as the website. Google shows a "hasn't been verified" notice for personal projects; choose **Continue**.
- **Check-up**: every line should show ✔.
- **Background start**: runs `scripts\setup-autostart.ps1` (see "Always on" below).
- **Sleep**: say **y** to keep the PC awake on mains power, so the daily run is never missed.

Within a minute the website shows **Studio computer ready**.

The first job takes longer: it downloads the video renderer's browser (about 100 MB) and, for edits, the speech-recognition model (about 500 MB for "Balanced").

**Mac instead:** `bash scripts/install-mac.sh` does the same and keeps the worker alive with launchd.

## Always on (autostart, restart, heartbeat)

Already installed with an older version? In the `verse-studio` folder, double-click **Set up autostart (Windows).cmd** once. It replaces the old "Verse Studio Worker" task.

What it sets up:

- A hidden scheduled task named **Verse Studio** that runs at sign-in and every 5 minutes. If the worker isn't running it starts it; if it has frozen (no sign of life for 5 minutes) it restarts it. No windows, no commands.
- Optional: answer **y** to run even when nobody is signed in (after Windows Update restarts the PC overnight). Windows asks for the account password once and stores it in Task Scheduler.
- A **Verse Studio** folder on the desktop and in the Start menu with: Start, Stop, Restart, **Autostart on-off**, Status, Worker log, and a link to the website.
- **Heartbeat**: the worker writes its status to Drive (`State/worker.json`) every 20 seconds, and every minute while it is making a video. The website shows it in the header and in **Settings → Studio computer** (status, last heartbeat, version, Claude status, next auto batch, last problem).

Switches, from anywhere (**Settings → Studio computer**, they apply within about a minute):

| Switch | Effect |
|---|---|
| Make videos | Off = paused. Still online and reporting, but no new videos or auto batches. |
| Start automatically and restart if closed | Off = keeps running now, but won't start after a restart or come back if it closes. Turn it back on from the website while it's online, or with the desktop shortcut. |
| Restart | Restarts the worker (after the current video, if one is in progress). |
| Update to latest version | Downloads the latest code from GitHub, installs packages, restarts. Your `.env` keys are never touched. |

On the PC, **Stop** turns it off until you press **Start** or restart the PC. **Autostart on-off** is the same switch as on the website.

## Studio features (green screen, lighting, styles)

- **Pixabay key** (free): sign up at pixabay.com, copy "Your API key" from pixabay.com/api/docs, paste it in **Settings → Advanced**. Turns on real photo/video backgrounds and the Stock footage look.
- **Background removal** runs on the studio computer (no green screen needed). The model (15 MB) downloads by itself the first time.
- **Styles**: Make → Edit starts from a style (Sermon clip, Full sermon · YouTube, Worship song, Worship Circle live song, Worship night promo, Monthly recap, Testimony, Devotional, Event recap, Creator). Change anything, then "Save these choices as a style". Defaults live in **Settings → Edit defaults**.
- **Effects gallery**: every title, caption, transition, camera move, colour look and extra has a moving sample. Tick several; Claude picks the best of the ticked ones per video.
- **Shapes**: Reel (9:16) or YouTube (16:9) for edits and verse videos; auto mode can make either or both. Ultra HD (4K) for YouTube.
- After this update, press **Settings → Studio computer → Update to latest version** once (installs the background-removal engine and new fonts).

## 5. First run

1. **Library**: add a few real tracks per mood (Pixabay Music and the YouTube Audio Library allow use on Instagram). Add her own recordings under **My music**, and some vertical clips or photos under **Backgrounds**.
2. **Settings**: check the signature, upload her profile photo as the logo, choose the themes and Telugu share, then **Save changes**.
3. **Make → Verse reels**: make 2 reels. They appear under **Reels** in a few minutes, each in "Library music", "My music" and "No music" versions.
4. When happy, turn on **Auto mode** (reels per day, time). Choose "Ask me to approve" for the first week.

---

## Day to day

- Phone: open the website, download the version she likes, tap **Copy caption**, post in Instagram. Silent versions are for adding trending audio inside Instagram.
- Uploading clips: **Make → Edit my videos**, add clips, say what the reel should be ("30 second reel of the carols, start with the kids, Telugu captions"), **Make my reel**.
- Everything is also in Drive under **Verse Studio/Output/<date>/** if she prefers the Drive app.

## Updating

From the website: **Settings → Studio computer → Update to latest version**. (By hand on the PC: `git pull`, `npm install`, then the Restart shortcut.) Vercel redeploys the website automatically on every push.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Studio computer offline" | PC asleep, off, or not signed in. It comes back by itself within 5 minutes once the PC is on (unless autostart is off: use the Start shortcut). Logs: `C:\Users\<name>\.verse-studio\service.log` and `worker.log`, or the "Worker log" shortcut |
| "Started by hand, can't restart itself" | Double-click **Set up autostart (Windows).cmd** once. |
| Job failed: "Claude Code isn't logged in" | On the PC run `claude`, then `/login`. |
| Job failed: "usage limit reached" | Her Claude plan hit its limit. It resets in a few hours; press **Try again**. Fewer reels per day, or "sonnet" under Settings → Advanced, uses less. |
| Google sign-in stops working after 7 days | The consent screen is still in "Testing". Publish it (step 2.3), then run `npm run login` on the PC again. |
| Website says "Access blocked: origin mismatch" | Add the exact Vercel address to the Website client's JavaScript origins. |
| Telugu captions have mistakes | Speech recognition is weaker in Telugu. Settings → Advanced → "Most accurate". Reels with Telugu text are marked **Check text**. |
| Run a full check | `npm run doctor` in the repo folder on the PC |

## Good to know

- **No commercial API keys.** Claude runs through the official Claude Code app logged in to her plan, for her own account's content. Everything else is free: Google Drive (15 GB), Vercel Hobby, Remotion (free for individuals and companies of up to 3 people), ffmpeg, whisper.cpp, and bible-api.com.
- **Scripture accuracy.** English verse text is fetched word-for-word from public-domain translations (WEB, KJV, ASV, BBE), not written by AI. Telugu verse text is written by Claude and always marked **Check text**, because no free Telugu Bible service exists. Check it before posting.
- **Music rights.** Only put music in the library that she is allowed to use. Commercial worship songs from Spotify or YouTube shouldn't be baked into videos. Use the "No music" version and add the song inside Instagram, which licenses it.
- **Posting stays manual.** Nothing is posted automatically. Third-party tools that auto-post, comment or DM can get Instagram accounts restricted.
- **Storage.** Each reel takes about 15 to 40 MB across its versions. Clear old dates out of `Output/` in Drive now and then.
