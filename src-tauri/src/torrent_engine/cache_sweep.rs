use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Engine files that are never swept.
const KEEP: &[&str] = &["dht.json", "engine.json", "session.json", "session.json.tmp"];

/// Deletes cached torrent data whose last write is older than
/// `retention_hours`, then trims the oldest entries to `max_gb`.
///
/// `protect` holds top-level names that belong to torrents still open in
/// the engine (being watched or queued); they are never removed here.
///
/// Age comes from the newest modification time found anywhere inside an
/// entry: on Windows a folder's own time does not change when a file deep
/// inside it is written, so the folder time alone can be far off.
pub fn run(dir: &Path, retention_hours: u64, max_gb: u64, protect: &HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    let max_age = Duration::from_secs(retention_hours.saturating_mul(3600));
    let mut kept: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if KEEP.contains(&name.as_str()) || protect.contains(&name) {
            continue;
        }
        let modified = newest_mtime(&path);
        let expired = if retention_hours == 0 {
            true
        } else {
            match modified {
                Some(m) => now.duration_since(m).map(|age| age >= max_age).unwrap_or(false),
                None => true,
            }
        };
        if expired {
            remove(&path);
            continue;
        }
        if max_gb > 0 {
            let size = entry_size(&path);
            kept.push((path, modified.unwrap_or(now), size));
        }
    }
    enforce_size_cap(kept, max_gb);
}

/// Latest modification time of a file, or of anything inside a folder.
fn newest_mtime(path: &Path) -> Option<SystemTime> {
    let meta = fs::symlink_metadata(path).ok()?;
    let own = meta.modified().ok();
    if !meta.is_dir() {
        return own;
    }
    let mut newest = own;
    if let Ok(entries) = fs::read_dir(path) {
        for e in entries.flatten() {
            if let Some(t) = newest_mtime(&e.path()) {
                if newest.map_or(true, |n| t > n) {
                    newest = Some(t);
                }
            }
        }
    }
    newest
}

fn enforce_size_cap(mut kept: Vec<(PathBuf, SystemTime, u64)>, max_gb: u64) {
    if max_gb == 0 {
        return;
    }
    let cap = max_gb.saturating_mul(1024 * 1024 * 1024);
    let mut total: u64 = kept.iter().map(|(_, _, s)| *s).sum();
    if total <= cap {
        return;
    }
    kept.sort_by_key(|(_, m, _)| *m);
    for (path, _, size) in kept {
        if total <= cap {
            break;
        }
        remove(&path);
        total = total.saturating_sub(size);
    }
}

fn entry_size(path: &Path) -> u64 {
    if path.is_dir() {
        match fs::read_dir(path) {
            Ok(entries) => entries.flatten().map(|e| entry_size(&e.path())).sum(),
            Err(_) => 0,
        }
    } else {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }
}

fn remove(path: &Path) {
    let _ = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
}
