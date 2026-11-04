# Harbor Frame Generation boost-6

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

## New in boost-6

### Automatic updates
- **Silent updates.** Harbor checks this project's releases in the background. When a new one is out it downloads the installer, checks its SHA-256 against the one GitHub publishes, and installs it quietly the next time you close Harbor. Nothing interrupts what you're watching. The next launch shows a small green "updated" note with a **Details** button that opens the release notes.
- From this release on you never need to download a setup by hand again.

### Collections
- **A Collections page** in the menu with curated collections, each in one row you can scroll sideways: Discover, Anime, Genres, Moods, TV Networks, Studios, Based On, Actors, Directors, Decades, Awards, World Cinema, Documentaries, Kids & Family and Reality TV. Duplicates were merged (anime genres sit with the genres, anime studios with the studios, and so on).
- **Folder pages look like Harbor**: a large header, then one row per catalog with Arabic names. Rows load as you scroll to them, and a catalog that turns out empty is hidden.
- **Networks and studios** show the company's own logo in its colours over a dimmed backdrop of its best-known title.
- **Anime catalogs come from AniList.** The MyAnimeList API isn't reachable on every network, which left anime folders empty. Home anime rows switch to AniList on their own when MyAnimeList can't be reached.
- Same-named rows on Home (for example two "IMDB" rows from a movie and a series catalog) are merged into one row.

### Home and navigation
- **Menu button only.** The icon rail is gone. A round menu button at the top opens the full menu with names; picking a page, clicking outside or Esc closes it.
- **Random banner.** The featured titles change on every launch, alternating a film or series with an anime, all released within about the last year and a half. The banner keeps the top and middle of the picture so faces aren't cut off.
- **Smoother mouse wheel.** Scrolling glides on every page, even when Windows animations are turned off.

### Player
- **Arabic subtitles with Gemini.** Add a free Gemini key in Settings > Library & metadata (a **Get key** button opens Google AI Studio). In the player's subtitle menu, **Translate to Arabic** turns any subtitle, embedded or loaded, in any language, into natural Arabic. The part you're watching is translated first; finished translations are kept and reused.
- **Exit full screen returns to the details page** of what you were watching.
- **Head start** never queues more frames than your target frame rate.

### Settings and look
- **Settings fully in Arabic** when the app language is Arabic.
- **MDBList key** has a **Get key** button; with it, the MDBList collections (Dubbed Only, Donghua) open.
- **Thmanyah font**: if the Thmanyah font is installed in Windows, Harbor uses it for all of its text, including the Harbor name. Title art and pictures are unchanged.

## New in boost-5

- **Head start.** RIFE now prepares frames ahead of the picture on screen, the way a video buffers before you reach it. Heavy scenes and short GPU spikes are covered by frames that are already finished, so they don't show as a stutter. Choose **Off**, **1 s** (default) or **2 s** in the Boost settings. The longer setting uses more memory and takes a moment longer to fill after a seek. It needs a little spare GPU power to build up, so it works best with a GPU limit of 80-85 % and a model that comfortably reaches your output frame rate.
- **Clearer home banner.** The featured film or series at the top of the home page is taller (600-780 px depending on your screen), shown at full brightness, with lighter shading over the picture.
- **Auto-advance bar.** The dot under the banner fills up while a title is shown and moves to the next one when it is full. It pauses while your mouse is over the banner.

## What Harbor does

- Browse films, series and anime from your Stremio addons, with catalogs, search, a watch list, continue-watching and calendars.
- Play streams in a native mpv player with subtitles, audio tracks, casting and downloads.

## What Boost adds

| Feature | What you get |
|---|---|
| **AI frame generation (RIFE)** | New in-between frames made by a neural network. A 24 fps film plays at 48, 60 or more fps. |
| **Smooth mode** | Light frame blending to your screen's refresh rate. Works on any GPU. |
| **Upscaling** | FSR, NIS or CAS shaders with adjustable sharpness. |
| **GPU budget** | You set a GPU limit (default 80 %). Boost measures RIFE's speed on your GPU once, picks the processing resolution and an output frame rate that divides your refresh rate evenly, then reads the real GPU use while you watch and adjusts to stay under the limit. |
| **Head start** | RIFE works up to 2 seconds ahead of the picture (new in boost-5). |

## Install

1. Download `Harbor_…_x64-setup.exe` below.
2. The installer isn't code-signed, so Windows SmartScreen may warn: click **More info → Run anyway**.
3. Play a film or an episode and click **✦** on the player bar. The gear next to it opens the settings.

The first time you switch frame generation on, about 60 MB (Python, VapourSynth, the RIFE engine and one model) is downloaded once.

If Windows says `lua51.dll was not found` on an older Harbor install, unzip `mpv-fix-x64.zip` into `%LOCALAPPDATA%\Harbor`.

## Recommended settings

| Setting | Recommended |
|---|---|
| Model | **RIFE 4.6** (fastest). Heavier models work too; Boost lowers the frame rate or resolution to stay inside your limit. |
| Output | **Auto** |
| Processing resolution | **Auto** (up to 1080p) |
| Head start | **1 s** |
| GPU limit | **80-85 %** |

This build updates itself from this project's releases (silently, when you close Harbor). It doesn't install official Harbor updates, because they would replace it and remove Boost.
