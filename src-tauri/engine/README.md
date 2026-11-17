# Streaming engine

The crates in this folder are the streaming engine from
[TorrentPlayer](https://github.com/torrentplayer/torrentplayer) 0.3.3, used by
Harbor's torrent playback (`src/torrent_engine/swarm.rs`).

| Crate | Role |
| --- | --- |
| `torrentplayer-swarm` | BitTorrent engine with deadline scheduling and cancel-on-seek |
| `torrentplayer-prioritize` | Piece prioritization around the playhead |
| `torrentplayer-torrent` | One API over the engine and its librqbit fallback |
| `torrentplayer-stream` | Seekable media readers |
| `torrentplayer-net` | Direct, SOCKS5 and WireGuard modes with a kill switch |
| `vendor/*` | Patched `librqbit-dht`, `librqbit-tracker-comms` and `tokio-wireguard` |

They are used unchanged apart from their `Cargo.toml` files, which list
dependency versions directly instead of inheriting them from a workspace.

Licensed under either of the MIT license (`LICENSE-MIT`) or the Apache
License 2.0 (`LICENSE-APACHE`), at your option.
