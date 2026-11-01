# Harbor Frame Generation boost-6

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

## New in boost-6

- **Icon rail.** The side menu now shows only its icons. The menu button (three lines) at the top opens it over the page with the names; pick a page, click outside or press Esc to close it.
- **Edge-to-edge banner.** The featured film, series or anime on the home page now spans the full width of the window.
- **Readable over any picture.** The Harbor name at the top, the search bar and the window buttons (close, maximize, minimize) sit on a dark glass backing, so they stay clear over bright images.
- **Smooth auto-advance bar.** The bar under the banner is now animated by the GPU instead of being resized every frame, so it no longer stutters, and it keeps moving while the mouse is over the banner. It uses the theme's accent colour.
- **Opens full screen.** Harbor starts full screen and covers the taskbar.

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

This build doesn't install official Harbor updates automatically, because they would replace it and remove Boost. You can check for updates manually in the settings.
