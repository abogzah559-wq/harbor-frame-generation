"""List the DLLs a Windows PE file imports and fail if any non-system DLL is
missing next to it. Used by CI to make sure mpv.exe ships with its DLLs."""
import os, struct, sys

def imports(path):
    d = open(path, "rb").read()
    pe = struct.unpack_from("<I", d, 0x3C)[0]
    nsec = struct.unpack_from("<H", d, pe + 6)[0]
    optsz = struct.unpack_from("<H", d, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", d, opt)[0]
    ddir = opt + (112 if magic == 0x20B else 96)
    imp_rva = struct.unpack_from("<I", d, ddir + 8)[0]
    secs = []
    for i in range(nsec):
        o = opt + optsz + i * 40
        vsz, va, rsz, rptr = struct.unpack_from("<IIII", d, o + 8)
        secs.append((va, max(vsz, rsz), rptr))
    def off(rva):
        for va, sz, p in secs:
            if va <= rva < va + sz:
                return rva - va + p
        raise ValueError(hex(rva))
    out, o = [], off(imp_rva)
    while True:
        name_rva = struct.unpack_from("<I", d, o + 12)[0]
        if name_rva == 0:
            break
        n = off(name_rva)
        out.append(d[n:d.index(b"\0", n)].decode())
        o += 20
    return out

exe = sys.argv[1]
here = {f.lower() for f in os.listdir(os.path.dirname(os.path.abspath(exe)))}
sysdir = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
# Present on every machine with a GPU driver, but not on CI runners.
driver = {"vulkan-1.dll", "opengl32.dll"}
names = imports(exe)
print("::notice::%s imports: %s" % (os.path.basename(exe), ", ".join(names)))
missing = [n for n in names
           if n.lower() not in here and n.lower() not in driver
           and not n.lower().startswith("api-ms-win-")
           and not os.path.exists(os.path.join(sysdir, n))]
print("::notice::bundled next to it: %s" % ", ".join(sorted(here)))
if missing:
    print("::error::missing DLLs for %s: %s" % (exe, ", ".join(missing)))
    sys.exit(1)
