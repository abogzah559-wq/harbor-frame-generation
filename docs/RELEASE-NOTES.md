# Harbor Frame Generation boost-8

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

## New in boost-8

### Updates
- **Settings → Advanced → Updates** now checks this project's releases (it used to ask a server that no longer exists). It shows the download progress, and when the new version is ready, **Restart now** installs it and opens Harbor again.
- Harbor looks for a new release 15 seconds after it starts and then every 30 minutes (it was every 3 hours). Before, a release published while Harbor was open could go unnoticed for up to 3 hours.
- When an update has downloaded, a small note offers **Restart now**. It stays out of the way while a video is playing.
- The beta channel, roll-back list and build rating were removed; they all depended on the old update server.

### Boost
- **Full quality again on strong GPUs.** The boost-7 logs showed Boost planning as if an RTX 4070 Super were a third of its real speed (4K played with 540p interpolation). Earlier builds lowered a saved speed factor on every false "lag" and never raised it back. That saved factor is reset once, and boost-7's fixes keep it from sinking again.
- Boost now writes the real GPU use to the player log every 20 seconds, so a problem can be traced to numbers instead of guesses.

### Installer
- Black installer with white text and a white logo.

### Other
- Thmanyah font pair in Settings → Theme → Fonts (uses the copy installed on your PC).
- The settings footer credits Harbor's original team and says who maintains this edition.

Earlier release notes are on the releases page.
