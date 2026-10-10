"""Tripo API helper (run once, offline). Prints credits used by every step.

  python3 tools/tripo.py model  assets/src/ref1.png     # image -> textured 3D (30 cr)
  python3 tools/tripo.py check  <model_task_id>         # pre-rig check (free)
  python3 tools/tripo.py rig    <model_task_id>         # auto rig (25 cr)
  python3 tools/tripo.py anim   <rig_task_id> preset:run # retarget animation (10 cr)
  python3 tools/tripo.py get    <task_id> out.glb       # download result
"""
import json, os, sys, time, urllib.request, uuid

API = "https://api.tripo3d.ai/v2/openapi"
KEY = os.environ["TRIPO_API_KEY"]

def call(path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, headers={"Authorization": f"Bearer {KEY}", "Content-Type": ctype})
    try:
        res = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")
    if res.get("code") != 0:
        sys.exit(f"API error: {res}")
    return res["data"]

def balance():
    return call("/user/balance")["balance"]

def upload(path):
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{os.path.basename(path)}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{b}--\r\n".encode()
    return call("/upload", raw=body, ctype=f"multipart/form-data; boundary={b}")["image_token"]

def run(task):
    before = balance()
    tid = call("/task", task)["task_id"]
    print("task", tid, task["type"], flush=True)
    while True:
        d = call(f"/task/{tid}")
        if d["status"] in ("success", "failed", "cancelled", "banned", "expired", "unknown"):
            break
        time.sleep(5)
    print("status", d["status"], "credits used", before - balance(), "balance", balance())
    print(json.dumps({k: v for k, v in d.items() if k in ("output", "status")}, indent=1)[:1500])
    return d

cmd = sys.argv[1]
if cmd == "balance":
    print(balance())
elif cmd == "model":
    run({"type": "image_to_model", "file": {"type": "png", "file_token": upload(sys.argv[2])},
         "texture": True, "face_limit": 20000})
elif cmd == "check":
    run({"type": "animate_prerigcheck", "original_model_task_id": sys.argv[2]})
elif cmd == "rig":
    run({"type": "animate_rig", "original_model_task_id": sys.argv[2], "out_format": "glb"})
elif cmd == "anim":
    run({"type": "animate_retarget", "original_model_task_id": sys.argv[2], "out_format": "glb",
         "animation": sys.argv[3], "bake_animation": True})
elif cmd == "get":
    out = call(f"/task/{sys.argv[2]}")["output"]
    url = out.get("model") or out.get("pbr_model")
    urllib.request.urlretrieve(url, sys.argv[3])
    print("saved", sys.argv[3], os.path.getsize(sys.argv[3]), "bytes")
