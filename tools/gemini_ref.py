"""Generate a character reference image with Gemini (run once, offline).

Usage: GEMINI_API_KEY=... python3 tools/gemini_ref.py out.png
"""
import base64, json, os, sys, urllib.request

MODEL = "gemini-2.5-flash-image"
PROMPT = (
    "Full-body 3D character reference of a tennis player, single character, front view, "
    "standing in a neutral A-pose with arms slightly away from the body and legs slightly apart, "
    "empty hands (no racket). Stylized, clean, low-detail game character; simple face without detailed features. "
    "Outfit: plain pure white short-sleeve shirt, plain pure white shorts, white cap, white socks, white sneakers, "
    "no logos, no patterns. Even studio lighting, no shadows on the ground, plain light gray background, "
    "whole body visible from head to feet, centered."
)

def main(out):
    body = {"contents": [{"parts": [{"text": PROMPT}]}],
            "generationConfig": {"responseModalities": ["IMAGE"]}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    res = json.load(urllib.request.urlopen(req, timeout=180))
    for part in res["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            open(out, "wb").write(base64.b64decode(part["inlineData"]["data"]))
            print("saved", out, "usage", res.get("usageMetadata"))
            return
    print("no image in response", json.dumps(res)[:500]); sys.exit(1)

if __name__ == "__main__":
    main(sys.argv[1])
