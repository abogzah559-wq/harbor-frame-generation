"""Compare old/new flags with ffmpeg scdet; write a report and the frame
numbers to show (around every disagreement)."""
import json, re, sys
d, scfile, out = sys.argv[1], sys.argv[2], sys.argv[3]
j = json.load(open(f"{d}/flags.json"))
fps = float(sys.argv[4])
old = {i for i, v in enumerate(j["old"]) if v}
new = {i for i, v in enumerate(j["new"]) if v}
sc = {}
t = None
for l in open(scfile, encoding="utf-8", errors="replace"):
    m = re.search(r"pts_time:([\d.]+)", l)
    if m:
        t = float(m[1])
    m = re.search(r"lavfi\.scd\.score=([\d.]+)", l)
    if m and t is not None and float(m[1]) >= 10:
        sc[round(t * fps) - 1] = float(m[1])
def near(f, s):
    return any(abs(f - x) <= 1 for x in s)
rep = []
rep.append(f"frames {len(j['old'])}  old {len(old)}  new {len(new)}  scdet {len(sc)}")
rep.append(f"scdet cuts caught: old {sum(near(f, old) for f in sc)}  new {sum(near(f, new) for f in sc)}")
rep.append(f"flags not near an scdet cut: old {sum(not near(f, sc) for f in old)}  new {sum(not near(f, sc) for f in new)}")
for name, s in (("old", old), ("new", new)):
    rep.append(f"{name}: " + " ".join(f"{f}({j['diff'][f]:.3f}{'*' if near(f, sc) else ''})" for f in sorted(s)))
rep.append("scdet: " + " ".join(f"{f}({j['diff'][f]:.3f},{sc[f]:.0f})" for f in sorted(sc) if f < len(j['diff'])))
show = sorted((old ^ new) | {f for f in sc if not near(f, new)})
open(out, "w").write("\n".join(rep) + "\n")
print("\n".join(rep))
open(out + ".show", "w").write(" ".join(map(str, show)))
