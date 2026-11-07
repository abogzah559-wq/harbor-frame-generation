"""Runs Boost's scene-cut detector (the exact code in src-tauri/src/boost.rs)
inside the same VapourSynth R79 runtime Harbor ships, on real video, and
compares it with the old rule (PlaneStatsDiff > 0.1) and ffmpeg's scdet.

usage: python sc_test.py boost.rs video.gray64x36 nframes out_dir
The .gray file is 64x36 float32 luma frames (ffmpeg -pix_fmt grayf32le).
"""
import sys, re, json, os
import numpy as np
import vapoursynth as vs

core = vs.core
rs, raw, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
src = open(rs, encoding="utf-8").read()
m = re.search(r'        try:\n(            luma = core\.resize.*?\n)(.*?            st = core\.std\.ModifyFrame\(.*?\)\n)', src, re.S)
assert m, "detector code not found"
body = m.group(2)
code = "\n".join(l[12:] for l in body.splitlines())

data = np.fromfile(raw, dtype=np.float32).reshape(-1, 36, 64)[:n]
n = len(data)
blank = core.std.BlankClip(width=64, height=36, format=vs.GRAYS, length=n, fpsnum=24, fpsden=1)

def fill(k, f):
    o = f.copy()
    np.asarray(o[0])[:] = data[k]
    return o

luma = core.std.ModifyFrame(blank, blank, fill)
ns = {"core": core, "vs": vs, "luma": luma}
exec(code, ns)
st = ns["st"]
new = [int(st.get_frame(i).props["_SceneChangeNext"]) for i in range(n)]
diff = [float(st.get_frame(i).props["PlaneStatsDiff"]) for i in range(n)]
old = [int(d > 0.1) for d in diff]
os.makedirs(out, exist_ok=True)
json.dump({"new": new, "old": old, "diff": diff}, open(os.path.join(out, "flags.json"), "w"))
print("frames", n, "old flags", sum(old), "new flags", sum(new))
