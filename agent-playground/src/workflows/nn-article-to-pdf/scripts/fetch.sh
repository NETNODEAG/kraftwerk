#!/usr/bin/env bash
# Deterministic article fetch from the NodeHive backend — no LLM involved.
# Takes a netnode.ch (or netnode.nodehive.app) article URL out of the request,
# resolves it via decoupled_router, pulls the node from JSON:API, turns the body
# into markdown (field_markdown as-is, paragraph HTML via turndown), embeds the
# teaser image as a data URI and writes inputs.json + inputs/ for the renderer.
set -u

: "${NN_BACKEND:=https://netnode.nodehive.app}"
export NN_BACKEND

python3 <<'PY'
import base64, json, os, re, shutil, subprocess, sys, tempfile
from urllib.parse import urlparse, quote
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

request = os.environ.get("REQUEST", "")
workflow_dir = os.environ.get("WORKFLOW_DIR", "")
backend = os.environ["NN_BACKEND"].rstrip("/")

def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

def get(url, what):
    try:
        with urlopen(Request(url, headers={"Accept": "application/vnd.api+json"}), timeout=30) as r:
            return json.loads(r.read().decode("utf8"))
    except (HTTPError, URLError, ValueError) as e:
        die(f"{what} failed: {url} ({e})")

# ---- 1. the URL out of the request ---------------------------------------
m = re.search(r'https?://[^\s"\'<>)]+', request)
if not m:
    die("no article URL found in request — pass a netnode.ch article URL")
url = m.group(0).rstrip('.,;')
site = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
path = urlparse(url).path.rstrip("/") or "/"
segments = [s for s in path.split("/") if s]
lang = segments[0] if segments and re.fullmatch(r"[a-z]{2}", segments[0]) else "de"

# ---- 2. slug -> node (decoupled_router) ----------------------------------
router = get(f"{backend}/{lang}/router/translate-path?path={quote(path)}", "router lookup")
entity = router.get("entity") or {}
uuid, bundle = entity.get("uuid"), entity.get("bundle")
if not uuid or not bundle:
    die(f"router did not resolve {path} to a node (got: {json.dumps(router)[:200]})")

# ---- 3. the node itself, with body paragraphs and teaser image ------------
doc = get(
    f"{backend}/{lang}/jsonapi/node/{bundle}/{uuid}"
    "?include=field_paragraphs,field_teaser_image.field_media_image",
    "node fetch",
)
json.dump(doc, open("article.json", "w"), indent=2, ensure_ascii=False)

data = doc["data"]
attrs = data["attributes"]
rels = data.get("relationships", {})
included = {(i["type"], i["id"]): i for i in doc.get("included", [])}
title = (attrs.get("title") or "").strip()

def text(field):
    v = attrs.get(field)
    if isinstance(v, dict):
        v = v.get("value")
    return (v or "").strip()

def plain(s):
    """Lead/teaser fields are sometimes rich text — flatten them to one line."""
    if "<" not in s:
        return s
    import html as htmlmod
    s = re.sub(r"<br\s*/?>|</p>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", htmlmod.unescape(s)).strip()

lead = plain(text("field_article_leadtext") or text("field_teaser_text"))

# ---- 4. body: markdown field first, paragraph HTML as fallback -----------
body, body_source = text("field_markdown"), "field_markdown"
if not body:
    chunks = []
    for ref in (rels.get("field_paragraphs", {}) or {}).get("data") or []:
        para = included.get((ref["type"], ref["id"]))
        if not para:
            continue
        for key, val in para.get("attributes", {}).items():
            if isinstance(val, dict) and (val.get("value") or "").strip():
                chunks.append(val["value"])
    if chunks:
        html_path = os.path.abspath("body.html")
        open(html_path, "w", encoding="utf8").write("\n".join(chunks))
        converter = os.path.join(workflow_dir, "scripts", "html-to-md.mjs")
        proc = subprocess.run(["node", converter, html_path, site],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            die(f"html -> markdown conversion failed: {proc.stderr.strip()[:300]}")
        body, body_source = proc.stdout.strip(), "field_paragraphs"
if not body:
    die(f"node {uuid} ({bundle}) has neither field_markdown nor text paragraphs "
        "— nothing to render")

# ---- 5. teaser image -> data URI (keeps the PDF self-contained) ----------
image_md = ""
media_ref = (rels.get("field_teaser_image", {}) or {}).get("data")
if media_ref:
    media = included.get((media_ref["type"], media_ref["id"]))
    file_ref = ((media or {}).get("relationships", {}).get("field_media_image", {}) or {}).get("data")
    if file_ref:
        alt = (file_ref.get("meta") or {}).get("alt") or title
        f = included.get((file_ref["type"], file_ref["id"]))
        uri = ((f or {}).get("attributes", {}).get("uri") or {}).get("url")
        mime = (f or {}).get("attributes", {}).get("filemime", "image/jpeg")
        if uri:
            src = uri if uri.startswith("http") else backend + uri
            try:
                with urlopen(Request(src), timeout=30) as r:
                    raw = r.read()
            except (HTTPError, URLError) as e:
                print(f"teaser image not fetched ({e}) — continuing without it", file=sys.stderr)
                raw = b""
            if raw:
                # keep the PDF small: downscale via sips when available (macOS)
                sips = shutil.which("sips")
                if sips and len(raw) > 200_000 and mime in ("image/jpeg", "image/png"):
                    with tempfile.TemporaryDirectory() as td:
                        ext = ".png" if mime == "image/png" else ".jpg"
                        a, b = os.path.join(td, "in" + ext), os.path.join(td, "out" + ext)
                        open(a, "wb").write(raw)
                        if subprocess.run([sips, "-Z", "1600", a, "--out", b],
                                          stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL).returncode == 0:
                            raw = open(b, "rb").read()
                b64 = base64.b64encode(raw).decode()
                image_md = f"![{alt}](data:{mime};base64,{b64})"

# ---- 6. assemble the document -------------------------------------------
parts = [f"# {title}"]
if lead:
    parts.append(f"*{lead}*")
if image_md:
    parts.append(image_md)
parts.append(f"Quelle: {url}")
parts.append(body)
md = "\n\n".join(parts) + "\n"

slug = segments[-1] if segments else "article"
os.makedirs("inputs", exist_ok=True)
name = f"01-{slug}.md"
open(os.path.join("inputs", name), "w", encoding="utf8").write(md)
json.dump(
    {"count": 1,
     "files": [{"source": url, "name": name}],
     "article": {"uuid": uuid, "bundle": bundle, "langcode": lang,
                 "title": title, "path": path, "backend": backend,
                 "body_source": body_source, "has_image": bool(image_md)}},
    open("inputs.json", "w"), indent=2, ensure_ascii=False,
)
print(f"fetched '{title}' ({bundle}/{uuid}) — body from {body_source}, "
      f"{len(body)} chars, image: {'yes' if image_md else 'no'}")
PY
rc=$?
[ $rc -ne 0 ] && exit $rc
[ -s inputs.json ] || { echo "inputs.json not produced" >&2; exit 1; }

TITLE=$(python3 -c 'import json; print(json.load(open("inputs.json"))["article"]["title"])')
SRC=$(python3 -c 'import json; print(json.load(open("inputs.json"))["article"]["body_source"])')
cat <<EOF
\`\`\`json
{"phase": "$PHASE", "status": "ok", "artifacts": ["inputs.json", "article.json"], "summary": "fetched article \"$TITLE\" from the NodeHive backend (body: $SRC)"}
\`\`\`
EOF
