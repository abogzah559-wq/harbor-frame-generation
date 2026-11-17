# Harbor Frame Generation boost-9

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

## New in boost-9

### Faster torrent playback
- **New streaming engine.** Torrents now play through a streaming-first engine (from [TorrentPlayer](https://github.com/torrentplayer/torrentplayer)). It downloads the exact part of the file the player is about to show first. Large and 4K files start sooner, and a seek resumes in about a second instead of waiting for the download to catch up.
- **The player reports its position every second**, so the engine always fetches what comes next and switches at once after a seek.
- **Next episode in the background.** Past 60 % of an episode from a season pack, the start of the next episode is downloaded quietly, so it is ready when you get there.
- **Boost is unaffected.** Frame generation works on the decoded picture inside mpv, after the video arrives, so it behaves exactly as before. Faster seeks also refill Boost's head start sooner.
- If the new engine cannot start, the classic engine takes over automatically. It can be turned off in **Settings → Player → P2P**.

### VPN protection for torrents
- **Settings → Player → P2P → Connection protection**: send torrent traffic through a **SOCKS5 proxy** or an **in-app WireGuard tunnel** (paste your `.conf` file; no adapter or admin rights needed).
- **Kill switch.** In both modes nothing is sent until the proxy or tunnel is verified, and if it drops, torrent traffic stops instead of using your normal connection. Harbor never falls back to a direct connection while protection is on.

### Watched episodes are cleaned up for real
- The "Keep cached files for" setting now measures age from the last time a file was written. Windows did not update a folder's date when files deep inside it changed, so some files were removed too early and others were kept too long.
- A torrent still being watched is never removed while you watch it.
- Torrents left open when Harbor closed no longer keep downloading in the background at the next start (that kept their files "fresh" forever).
- Files saved with the **Download** button are not touched.

### Arabic subtitle translation works again
- Translation used `gemini-2.5-flash`, which Google no longer serves to new API keys, and a fallback model that was shut down in June 2026, so a newly added key always failed. Harbor now uses the current Gemini Flash models, picks the first one your key can use and remembers it.
- **New: automatic Arabic** (on by default, Settings → Library & Metadata). When a title has no Arabic subtitle, the selected subtitle (English first) is translated as soon as playback starts.
- A rejected key now shows a clear message.

### Home page
- **Bigger banner.** The "Your Streaming" row (Netflix, Disney+ and others) was removed and the banner takes its space.
- **Banner rules.** Every title in the banner now has a sharp, text-free backdrop of at least 1920 px (shown at full size) and a synopsis. Anime that had no synopsis now gets one from TMDB in English or AniList, translated to Arabic when a Gemini key is set. Only titles released in the last two years are shown, alternating films/series and anime, and the list refreshes every six hours.
- **Top 10.** Larger cards. Hovering a card slides the poster aside and lights up its rank number.

### Anime collections
- **Fixed cover art.** The anime collections now use 23 cover images that ship with the app, so every install looks the same. Before, tiles showed a backdrop from whatever title was trending, which differed from PC to PC.
- **Separate anime genres and moods.** Anime genres and anime moods have their own rows next to the anime rows; the main Genres and By mood rows are films and series only. Genre-style folders inside the Anime collection were merged into the matching genre, so nothing is listed twice.
- Collection tiles lift, zoom slowly into their art and glow softly on hover.

### Title pages
- The backdrop and title no longer change several times after a page opens. Harbor now waits for the details, picks one backdrop of at least 1920 px, fades it in once and keeps it. The 12-second backdrop rotation was removed (the gallery is still in the Media tab).

Earlier release notes are on the releases page.
