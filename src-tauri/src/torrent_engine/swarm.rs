//! The streaming-first engine behind Harbor's torrent commands.
//!
//! torrentplayer-swarm fetches the exact part of a file the player asks for
//! first (so a seek resumes in about a second), keeps a read-ahead window
//! in front of the playhead, and pre-fetches the next episode of a season
//! pack. All of its traffic goes through one network manager: direct, a
//! SOCKS5 proxy, or an in-app WireGuard tunnel, and in the two protected
//! modes nothing leaves the machine unless the tunnel or proxy works.
//!
//! Harbor's own HTTP route (`/stream/{hash}/{file}`) serves these torrents
//! too, so the player, casting and the LAN server need no changes. When this
//! engine cannot start or refuses a torrent, the classic engine takes over.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::Mutex as AsyncMutex;
use torrentplayer_net::{
    Network, NetworkConfig, NetworkMode, NetworkOptions, NetworkStatus, Secret, Socks5Config,
    WireGuardConfig,
};
use torrentplayer_stream::MediaSource;
use torrentplayer_torrent::{
    EngineChoice, Playback, StreamEngine, StreamEngineConfig, TorrentId, TorrentInfo, TorrentSource,
};

use super::EngineFile;

/// Network settings saved in `engine.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct NetSettings {
    /// "direct", "socks5" or "wireguard".
    pub mode: String,
    pub socks_host: String,
    pub socks_port: u16,
    pub socks_user: String,
    pub socks_pass: String,
    /// The text of a WireGuard `.conf` file.
    pub wireguard_conf: String,
    pub allow_ipv6: bool,
}

impl NetSettings {
    /// SOCKS5 or WireGuard: torrent traffic must never go out directly.
    pub fn is_protected(&self) -> bool {
        matches!(self.mode.as_str(), "socks5" | "wireguard")
    }

    fn to_config(&self) -> NetworkConfig {
        let mode = match self.mode.as_str() {
            "socks5" => NetworkMode::Socks5(Socks5Config {
                host: self.socks_host.trim().to_string(),
                port: self.socks_port,
                username: Some(self.socks_user.trim().to_string()).filter(|s| !s.is_empty()),
                password: Some(self.socks_pass.clone()).filter(|s| !s.is_empty()).map(Secret::new),
                remote_dns: true,
                proxy_trackers: true,
                proxy_dht: true,
            }),
            "wireguard" => match WireGuardConfig::parse(&self.wireguard_conf) {
                Ok((cfg, _warnings)) => NetworkMode::WireGuard(cfg),
                Err(e) => {
                    // A protected mode that cannot work holds all traffic rather than
                    // silently falling back to a direct connection.
                    return NetworkConfig {
                        mode: NetworkMode::Direct,
                        allow_ipv6: self.allow_ipv6,
                        hold: Some(format!("the WireGuard configuration is invalid: {e}")),
                    };
                }
            },
            _ => NetworkMode::Direct,
        };
        NetworkConfig { mode, allow_ipv6: self.allow_ipv6, hold: None }
    }
}

/// A file being played.
struct Active {
    torrent: TorrentId,
    file: usize,
    /// Dropping it stops prioritizing the playhead.
    playback: Playback,
    media: Arc<dyn MediaSource>,
    /// The next video of the same torrent, once its start and end were requested.
    next_prefetched: bool,
}

pub struct Swarm {
    engine: StreamEngine,
    network: Network,
    infos: Mutex<HashMap<String, TorrentInfo>>,
    /// Keyed by lower-case info hash: one played file per torrent.
    active: Mutex<HashMap<String, Active>>,
    /// A protected network mode is selected.
    protected: AtomicBool,
}

/// Serializes starting and stopping the engine.
static STARTING: AsyncMutex<()> = AsyncMutex::const_new(());
/// The running engine; read without waiting by the stream route and the
/// other commands.
static RUNNING: RwLock<Option<Arc<Swarm>>> = RwLock::new(None);

/// The running engine, started on first use. `None` when it cannot start
/// (the caller then uses the classic engine).
pub async fn get(dir: PathBuf, net: &NetSettings) -> Option<Arc<Swarm>> {
    if let Some(s) = running() {
        return Some(s);
    }
    let _guard = STARTING.lock().await;
    if let Some(s) = running() {
        return Some(s);
    }
    match start(dir, net).await {
        Ok(s) => {
            let s = Arc::new(s);
            *RUNNING.write().unwrap_or_else(|e| e.into_inner()) = Some(s.clone());
            Some(s)
        }
        Err(e) => {
            eprintln!("[torrent-engine] fast engine unavailable, using the classic one: {e}");
            None
        }
    }
}

/// The engine if it is already running; never starts it.
pub fn running() -> Option<Arc<Swarm>> {
    RUNNING.read().unwrap_or_else(|e| e.into_inner()).clone()
}

async fn start(dir: PathBuf, net: &NetSettings) -> Result<Swarm, String> {
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let network = Network::start(net.to_config(), NetworkOptions::default())
        .await
        .map_err(|e| format!("network: {e}"))?;
    let mut config = StreamEngineConfig::new(dir.clone());
    config.choice = EngineChoice::Auto;
    config.dht_state_dir = Some(dir);
    let engine = StreamEngine::start_with_network(config, Some(network.clone()))
        .await
        .map_err(|e| format!("engine: {e}"))?;
    Ok(Swarm {
        engine,
        network,
        infos: Mutex::new(HashMap::new()),
        active: Mutex::new(HashMap::new()),
        protected: AtomicBool::new(net.is_protected()),
    })
}

/// Stops the engine (app exit or a full engine reset).
pub async fn shutdown() {
    let _guard = STARTING.lock().await;
    let taken = RUNNING.write().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(s) = taken {
        s.active.lock().unwrap_or_else(|e| e.into_inner()).clear();
        s.engine.shutdown().await;
        s.network.shutdown();
    }
}

fn magnet_with_trackers(magnet: &str, trackers: &[String]) -> String {
    let mut out = magnet.to_string();
    for tr in trackers {
        if tr.is_empty() || out.contains(tr.as_str()) {
            continue;
        }
        out.push_str("&tr=");
        out.push_str(&url::form_urlencoded::byte_serialize(tr.as_bytes()).collect::<String>());
    }
    out
}

fn file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn is_video(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts", ".m2ts", ".wmv", ".flv"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

impl Swarm {
    /// Adds a torrent (or returns it if already added) and lists its files.
    pub async fn add(&self, magnet: &str, trackers: &[String]) -> Result<(String, Vec<EngineFile>), String> {
        let source = TorrentSource::parse_link(&magnet_with_trackers(magnet, trackers))
            .map_err(|e| e.to_string())?;
        let info = tokio::time::timeout(std::time::Duration::from_secs(60), self.engine.add(source))
            .await
            .map_err(|_| "metadata timed out: no peers reached in 60s".to_string())?
            .map_err(|e| e.to_string())?;
        let hash = info.info_hash.to_ascii_lowercase();
        let files = info
            .files
            .iter()
            .map(|f| EngineFile { idx: f.index, name: file_name(&f.path), length: f.len })
            .collect();
        self.infos.lock().unwrap_or_else(|e| e.into_inner()).insert(hash.clone(), info);
        Ok((hash, files))
    }

    fn info(&self, hash: &str) -> Option<TorrentInfo> {
        self.infos.lock().unwrap_or_else(|e| e.into_inner()).get(&hash.to_ascii_lowercase()).cloned()
    }

    pub fn has(&self, hash: &str) -> bool {
        self.info(hash).is_some()
    }

    /// Starts playing one file: selects it, prioritizes its playhead and
    /// makes it readable through [`Swarm::media`].
    pub async fn select(&self, hash: &str, file: usize) -> Result<(), String> {
        let hash = hash.to_ascii_lowercase();
        let info = self.info(&hash).ok_or_else(|| "no torrent".to_string())?;
        if let Some(a) = self.active.lock().unwrap_or_else(|e| e.into_inner()).get(&hash) {
            if a.file == file {
                return Ok(());
            }
        }
        let id = info.id;
        let _ = self.engine.set_paused(id, false).await;
        let _ = self.engine.set_download_limit(id, None);
        let playback = self
            .engine
            .start_playback(id, file, torrentplayer_prioritize::Config::default())
            .await
            .map_err(|e| e.to_string())?;
        let media = self.engine.media_source(id, file).await.map_err(|e| e.to_string())?;
        self.active.lock().unwrap_or_else(|e| e.into_inner()).insert(
            hash,
            Active { torrent: id, file, playback, media, next_prefetched: false },
        );
        Ok(())
    }

    /// The readable file, if it is the one being played.
    pub fn media(&self, hash: &str, file: usize) -> Option<Arc<dyn MediaSource>> {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        active
            .get(&hash.to_ascii_lowercase())
            .filter(|a| a.file == file)
            .map(|a| a.media.clone())
    }

    /// The next video after `file` in the torrent, in path order (the next
    /// episode of a season pack).
    fn next_video(&self, hash: &str, file: usize) -> Option<usize> {
        let info = self.info(hash)?;
        let mut videos: Vec<_> = info.files.iter().filter(|f| is_video(&f.path)).collect();
        videos.sort_by(|a, b| a.path.to_ascii_lowercase().cmp(&b.path.to_ascii_lowercase()));
        let pos = videos.iter().position(|f| f.index == file)?;
        videos.get(pos + 1).map(|f| f.index)
    }

    /// The player's position. Seeks take effect at once; past 60 % of the
    /// episode the next one in the same torrent starts downloading quietly.
    pub async fn playhead(&self, hash: &str, file: usize, position: f64, duration: Option<f64>) {
        let hash = hash.to_ascii_lowercase();
        let prefetch = {
            let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
            let Some(a) = active.get_mut(&hash).filter(|a| a.file == file) else {
                return;
            };
            a.playback.update(position.max(0.0), duration.filter(|d| *d > 0.0));
            let late = duration.is_some_and(|d| d > 0.0 && position / d >= 0.6);
            if late && !a.next_prefetched {
                a.next_prefetched = true;
                Some(a.torrent)
            } else {
                None
            }
        };
        if let Some(id) = prefetch {
            if let Some(next) = self.next_video(&hash, file) {
                if let Some(a) = self.active.lock().unwrap_or_else(|e| e.into_inner()).get(&hash) {
                    a.playback.set_next_file(Some(next));
                }
                if let Err(e) = self.engine.prefetch_file(id, Some(next)).await {
                    eprintln!("[torrent-engine] next episode prefetch failed: {e}");
                }
            }
        }
    }

    /// Download progress for the stats overlay: peers, speed, bytes of the
    /// played file and whether it is complete.
    pub async fn stats(&self, hash: &str, file: Option<usize>) -> Option<(usize, u64, u64, u64, u64, bool, String)> {
        let info = self.info(hash)?;
        let s = self.engine.stats(info.id).await.ok()?;
        let (progress, len) = match file.and_then(|i| info.files.iter().find(|f| f.index == i)) {
            Some(f) => (s.file_progress.get(f.index).copied().unwrap_or(0), f.len),
            None => (s.progress_bytes, info.total_len),
        };
        Some((
            s.peers_live as usize,
            s.download_bps,
            s.progress_bytes,
            progress,
            len,
            len > 0 && progress >= len,
            format!("{:?}", s.state),
        ))
    }

    /// Stops a torrent. Its data stays in the cache, where the sweeper
    /// removes it after the retention time.
    pub async fn remove(&self, hash: &str) -> bool {
        let hash = hash.to_ascii_lowercase();
        let Some(info) = self.infos.lock().unwrap_or_else(|e| e.into_inner()).remove(&hash) else {
            return false;
        };
        self.active.lock().unwrap_or_else(|e| e.into_inner()).remove(&hash);
        if let Err(e) = self.engine.remove(info.id).await {
            eprintln!("[torrent-engine] remove failed: {e}");
        }
        true
    }

    /// Lower-case info hashes of torrents open in this engine.
    pub fn open_hashes(&self) -> Vec<String> {
        self.infos.lock().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect()
    }

    /// Whether all torrent traffic must stay on this engine (SOCKS5 / WireGuard).
    pub fn is_protected(&self) -> bool {
        self.protected.load(Ordering::Relaxed)
    }

    pub fn network_status(&self) -> NetworkStatus {
        self.network.status()
    }

    pub async fn apply_network(&self, net: &NetSettings) -> Result<NetworkStatus, String> {
        self.protected.store(net.is_protected(), Ordering::Relaxed);
        self.engine
            .apply_network(net.to_config())
            .await
            .map_err(|e| e.to_string())
    }
}
