# Harbor Frame Generation boost-7

Harbor Frame Generation is a Windows build of [Harbor](https://github.com/harborstremio/harbor), a desktop app for watching films and series through Stremio addons, with **Boost** added to its built-in mpv player: AI frame generation, GPU upscaling and a GPU budget that keeps playback smooth. Everything runs inside Harbor; no other program is needed.

## New in boost-7

Frame generation in fast scenes. In boost-6 a fast camera move could make Boost stutter as if frame generation had switched off. There were three causes:

- **False scene cuts.** Scene detection treated any big change between two frames as a cut. A fast pan is a big change too, so RIFE repeated frames instead of creating them, exactly in the fast scenes. A cut is now a sudden spike that stands out from the frames around it, or a jump in the picture's brightness histogram. Camera motion does neither. On the Sintel trailer the old rule fired 12 times, 5 of them on motion. The new rule fires 7 times, on all 7 real cuts and nothing else.
- **Filter reloads every ~35 s.** The GPU feedback lowered the plan when the GPU went over your limit, then raised it again a minute later, and so on (900p ↔ 1080p). Each change reloads the filter, which is a visible hitch. A plan that went over the limit is now held off for 10 minutes.
- **Downgrades from drops that weren't the GPU's fault.** About a third of the "Boost lowered its load" events came from 1.5–4 dropped frames per second with perfect A/V sync, and lowering the plan didn't change them. Boost now waits 15 s after a reload, restarts its count after a seek, and only lowers the plan for a clear overload (more than 4 drops/s or A/V drift).

Also:
- If mpv reports that the frame-generation buffer was too small, Boost reloads once with a bigger buffer instead of turning frame generation off.

Full notes for earlier releases are on the releases page.
