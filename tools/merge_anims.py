"""Copy the animation from other Tripo GLBs (same rig) into a base GLB.

Usage: python3 tools/merge_anims.py base.glb out.glb name1=a.glb name2=b.glb ...
Node indices must match (Tripo retargets keep the same node order).
"""
import json, struct, sys

def load(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack("<I", b[off:off + 4])[0]
    return j, bytearray(b[off + 8:off + 8 + bl])

def save(path, j, binbuf):
    while len(binbuf) % 4: binbuf += b"\0"
    j["buffers"][0]["byteLength"] = len(binbuf)
    js = json.dumps(j, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binbuf), 0x004E4942) + binbuf)

base, bbin = load(sys.argv[1])
names = [n.get("name") for n in base["nodes"]]
for arg in sys.argv[3:]:
    name, path = arg.split("=", 1)
    j, jbin = load(path)
    assert [n.get("name") for n in j["nodes"]] == names, f"{path}: node order differs"
    anim = j["animations"][0]
    acc_map = {}
    def copy_acc(ai):
        if ai in acc_map: return acc_map[ai]
        a = dict(j["accessors"][ai]); v = j["bufferViews"][a["bufferView"]]
        start = v.get("byteOffset", 0)
        data = jbin[start:start + v["byteLength"]]
        while len(bbin) % 4: bbin.append(0)
        base["bufferViews"].append({"buffer": 0, "byteOffset": len(bbin), "byteLength": len(data)})
        bbin.extend(data)
        a["bufferView"] = len(base["bufferViews"]) - 1
        base["accessors"].append(a)
        acc_map[ai] = len(base["accessors"]) - 1
        return acc_map[ai]
    samplers = [{"input": copy_acc(s["input"]), "output": copy_acc(s["output"]),
                 "interpolation": s.get("interpolation", "LINEAR")} for s in anim["samplers"]]
    base.setdefault("animations", []).append({"name": name, "samplers": samplers, "channels": anim["channels"]})
    print("added", name, len(anim["channels"]), "channels")
save(sys.argv[2], base, bbin)
