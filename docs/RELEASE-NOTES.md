# Harbor Frame Generation boost-13

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

> If you are on boost-11 or older, install this release once by hand; from boost-12 on, updates install by themselves.

## New in boost-13

### A cleaner source list
- **Only real sources.** Rows that are not videos are gone: recommendation lists ("Watch Next"), rating summaries, "join our Discord", "sync your debrid library", subscription notices, and links that only open a web page or YouTube.
- **Instant sources first.** Sources that start at once (cached on your debrid, marked ⚡, [+RD] or "instant") now always sit at the top, whatever your addon order.
- **Debrid links get time to start.** Debrid links can take 20-30 seconds to resolve on the debrid side; Harbor gave up after 18 seconds and bounced back to the list. It now waits up to 40 seconds.
- **No Torrentio-with-debrid source is added automatically anymore.** Real-Debrid refuses many requests coming from Torrentio's servers and plays an "Access denied" video instead. Plain Torrentio stays, and its torrents play through your own debrid key from your own connection.

### Arabic
- **Continue Watching** cards now show Arabic titles too.

## boost-12

### Updates install for real
- Downloaded updates now install reliably. Before, a hidden helper script was supposed to run the installer after Harbor closed, but it was often stopped first, so the same update downloaded again and again and never installed. The installer now runs directly when Harbor closes, or right away with **Restart now** (Harbor reopens when it is done).
- An update that was already downloaded is reused instead of downloaded again, and old update files are removed.

### Sources that actually play
- **Torrentio is always included.** Setups with only a small regional torrent addon (for example Peerflix, which mostly returns Spanish releases with a handful of peers) stalled on "Connecting". Torrentio's well-seeded releases are now always searched as well.
- **Message rows are hidden.** Some addons add rows that are messages, not videos ("searches disabled, use a debrid provider", "donation needed", "invalid key"). They no longer appear in the list.
- **No more endless "Connecting".** A torrent that has not started after 45 seconds has no usable peers; Harbor now moves on instead of waiting forever.

## boost-11

### Much faster updates
- **Parallel download.** Updates now download in 8 parallel pieces instead of one stream. On many connections a single download from GitHub crawled along for half an hour or more.
- **Resumes where it stopped.** Closing Harbor in the middle of an update download no longer throws it away: the next start continues from the pieces already saved.
- **Smaller installer.** ffmpeg and ffprobe now share one set of libraries instead of shipping two full copies, which makes the installer, and every update, considerably smaller.

### Collections
- **No more black blink on hover.** Collection cards with an animated hover picture hid their cover before the animation had loaded, so the card flashed black for a moment. The cover now stays until the animation is ready, and the cards are prepared for the hover effect in advance.

### Lighter Arabic titles
- Card titles are translated 25 at a time in one request instead of one request each, and synopses are only translated where they are shown (title pages, the banner, search), not for every card in every row. Pages fill in Arabic faster and use far less data.

## boost-10

### Fully Arabic
- **Arabic only.** The whole interface is now in Arabic, including hundreds of screens and messages that were still in English. The English and Portuguese interface options were removed.
- **Arabic titles and stories everywhere.** Cards, Top 10, the banner, search results and title pages show each title's Arabic name and synopsis. Harbor uses TMDB's official Arabic text when your TMDB key is set, and free Google Translate for anything still in English, so stories are readable in Arabic even without a key. Results are cached, so each title is looked up once.
- **Thmanyah font.** When the free Thmanyah font is installed in Windows, Harbor uses it for every text and for subtitles. If it is missing, a card on the home page links to the official download page (the font's license does not allow shipping it inside apps).
- **TMDB key prompt.** New users see a clear card explaining that their own free TMDB key turns on Arabic titles and Arabic search.

### Search
- **Search closes instantly.** Clicking outside the box or the new close button now always closes search. The empty area around the box was treated as a window-drag area, so clicks there were swallowed.
- **Lighter search screen.** The full-screen blur behind search was removed; it made typing and scrolling stutter on busy pages.
- **Arabic or English, both work.** An Arabic query is sent to TMDB as typed and to Cinemeta, anime and addon catalogs in English, so a title is found whichever language you type it in.

### Sources and playback
- **Broken sources are hidden.** Debrid links that still need downloading on the debrid side (they never start) and torrents with fewer than 3 seeders are no longer listed. If that would leave nothing, everything is shown.
- **Debrid keys now always work.** A Real-Debrid, AllDebrid, Premiumize or Debrid-Link key in Settings only reached the built-in Torrentio before, so with other addons (Peerflix, TorrentClaw and others) debrid links never appeared. Harbor now adds a Torrentio source wired to your key automatically.
- **Less stop-and-go buffering.** After a stall, the player refills a few seconds before resuming instead of one, so a slow moment becomes one short pause instead of a string of stutters.

### Arabic subtitles
- **Arabic first, always.** Arabic is now the first subtitle language, subtitles are on by default, and Harbor switches to an Arabic subtitle as soon as one arrives from your subtitle addons (SubDL, SubSource and others answer a few seconds after playback starts).
- **Instant translation.** When a title has no Arabic subtitle, the lines right where you are are translated with free Google Translate and shown within a second or two. With a Gemini key, the full subtitle is then translated with Gemini for better quality and replaces it; without a key, Google translates the rest.
- **Faster start.** Automatic translation starts 3.5 seconds into playback instead of 8, and it prefers a downloaded subtitle over one built into the video (reading a built-in subtitle from a torrent means fetching the whole file first).
- **More Gemini models.** Gemini 3.7 Flash, 3.1 Flash-Lite and the latest Flash alias were added to the list, and if Gemini runs out of quota mid-way, Google finishes the job instead of leaving English.

### Home page
- **Opens instantly.** The rows you saw last time are shown at once on the next start and refreshed in the background, instead of a blank page while every row loads.
- **No more gaps in rows.** Posters show right away while a better version is looked up, instead of leaving empty cards.
- **New Top 10 hover.** The poster lifts, turns slightly toward its number and catches a sweep of light, while the rank fills with colour and glows.
- **Collection cards fixed.** Hovering a collection card no longer makes its artwork spill past the rounded corners or overlap its neighbours.

## boost-9

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
