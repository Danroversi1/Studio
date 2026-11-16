#!/usr/bin/env python3
"""STUDIO Local Renderer: the companion that generates storyboard frames on this computer.

How it works
  * It connects OUT to Studio over HTTPS with a device token (made by pairing once with a
    code from Studio). Studio never connects into this computer.
  * It asks Studio for the next frame the director explicitly submitted for THIS computer,
    downloads only that job's input pictures, and runs one allowlisted, versioned workflow
    (from the local `workflows/` folder) on a renderer bound to this computer only
    (ComfyUI on 127.0.0.1 by default).
  * Studio sends only validated values (workflow id, prompt text, seed, size, which picture
    goes in which slot). It cannot send commands, file paths or workflow graphs.
  * Results are saved here first (results/), then uploaded through Studio's checked upload.
    If the upload fails, the picture stays here and is sent again later (the picture is
    never re-generated just to upload it).

Python 3.9+, standard library only. Run `python studio_renderer.py --help`.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import platform
import random
import socket
import stat
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
DEFAULT_HOME = Path(os.environ.get("STUDIO_RENDERER_HOME", Path.home() / ".studio-renderer"))
ROLES = {"composition", "start_frame", "cast", "location", "look"}
FAIL_CODES = {"cancelled", "out_of_memory", "missing_model", "workflow_not_ready", "renderer_unreachable",
              "renderer_error", "bad_input", "upload_failed", "missing_input", "timeout"}


class RendererError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code if code in FAIL_CODES else "renderer_error"


# ---------------------------------------------------------------------------------------
# Small HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------------------
def http(method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 30) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_json(method: str, url: str, data: Any = None, headers: dict[str, str] | None = None, timeout: float = 30) -> tuple[int, Any]:
    h = {"Content-Type": "application/json", "Accept": "application/json", **(headers or {})}
    status, raw = http(method, url, json.dumps(data).encode() if data is not None else None, h, timeout)
    try:
        return status, json.loads(raw.decode() or "null")
    except ValueError:
        return status, {"error": raw[:200].decode(errors="replace")}


def is_loopback(url: str) -> bool:
    host = urllib.parse.urlparse(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


# ---------------------------------------------------------------------------------------
# Config (token kept in a file only this user can read)
# ---------------------------------------------------------------------------------------
class Config:
    def __init__(self, home: Path):
        self.home = home
        self.path = home / "config.json"
        self.data: dict[str, Any] = json.loads(self.path.read_text()) if self.path.exists() else {}

    def save(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2))
        try:
            os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        tmp.replace(self.path)

    @property
    def studio(self) -> str:
        return self.data.get("studio_url", "")

    @property
    def comfy(self) -> str:
        return self.data.get("comfy_url", "http://127.0.0.1:8188")

    @property
    def token(self) -> str:
        return self.data.get("token", "")

    def results(self) -> Path:
        p = self.home / "results"
        p.mkdir(parents=True, exist_ok=True)
        return p


def check_studio_url(url: str, allow_insecure: bool) -> str:
    u = urllib.parse.urlparse(url.rstrip("/"))
    if u.scheme == "https" or (allow_insecure and u.scheme == "http" and is_loopback(url)):
        return f"{u.scheme}://{u.netloc}"
    raise SystemExit("Studio's address must start with https://")


# ---------------------------------------------------------------------------------------
# Workflows: allowlisted folders with a manifest + a graph exported from ComfyUI (API format)
# ---------------------------------------------------------------------------------------
class Workflow:
    def __init__(self, folder: Path):
        self.folder = folder
        self.manifest: dict[str, Any] = json.loads((folder / "manifest.json").read_text())
        self.id: str = self.manifest["id"]
        self.version: str = str(self.manifest["version"])
        graph_file = folder / self.manifest.get("graph", "graph.api.json")
        self.graph: dict[str, Any] | None = json.loads(graph_file.read_text()) if graph_file.exists() else None
        self.graph_file = graph_file

    def node_by_title(self, graph: dict[str, Any], title: str) -> str | None:
        for nid, node in graph.items():
            if (node.get("_meta") or {}).get("title") == title:
                return nid
        return None

    def check(self, object_info: dict[str, Any] | None) -> list[str]:
        """Problems that stop this workflow from running (empty = ready)."""
        problems: list[str] = []
        if self.graph is None:
            return [f"Missing {self.graph_file.name}: export the workflow from ComfyUI (see README, step 4)."]
        b = self.manifest["bindings"]
        titles = [b["prompt"]["title"], b["output"]["title"]] + [s["title"] for s in b["images"]]
        titles += [b[k]["title"] for k in ("seed", "width", "height", "steps") if b.get(k)]
        for s in b["images"]:
            titles += (s.get("bypass") or {}).get("remove", [])
        for t in sorted(set(titles)):
            if self.node_by_title(self.graph, t) is None:
                problems.append(f'No node titled "{t}" in {self.graph_file.name}.')
        if object_info is None:
            problems.append("ComfyUI isn't reachable, so nodes and models couldn't be checked.")
            return problems
        for nid, node in self.graph.items():
            cls = node.get("class_type")
            if cls not in object_info:
                problems.append(f"ComfyUI has no node type {cls} (update ComfyUI).")
                continue
            # Model files: every loader input whose value must be one of the installed files.
            spec = {**(object_info[cls].get("input", {}).get("required", {})), **(object_info[cls].get("input", {}).get("optional", {}))}
            for name, value in node.get("inputs", {}).items():
                allowed = spec.get(name, [None])[0]
                if isinstance(value, str) and isinstance(allowed, list) and name.endswith(("_name", "ckpt_name", "unet_name", "clip_name", "vae_name", "lora_name")) and value not in allowed:
                    problems.append(f"Model file not installed: {value} (needed by {cls}).")
        return problems

    def report(self, object_info: dict[str, Any] | None) -> dict[str, Any]:
        m = self.manifest
        problems = self.check(object_info)
        return {
            "id": self.id, "version": self.version, "title": m.get("title", self.id), "model": m.get("model", ""),
            "license": m.get("license", ""), "licenseUrl": m.get("license_url"), "ready": not problems, "problems": problems[:12],
            "maxImages": len(m["bindings"]["images"]), "conditioning": m["conditioning"], "sizes": m["sizes"], "presets": m["presets"],
            "params": m["params"], "settingsNote": m.get("settings_note", ""),
        }

    def build(self, prompt: str, params: dict[str, Any], images: list[str]) -> tuple[dict[str, Any], str]:
        """A copy of the graph with Studio's validated values bound in. Unused image slots are
        removed and their links passed through, as declared in the manifest."""
        assert self.graph is not None
        g: dict[str, Any] = json.loads(json.dumps(self.graph))
        b = self.manifest["bindings"]

        def put(binding: dict[str, Any], value: Any) -> None:
            nid = self.node_by_title(g, binding["title"])
            if nid is None:
                raise RendererError("workflow_not_ready", f'Workflow node "{binding["title"]}" is missing.')
            g[nid]["inputs"][binding["input"]] = value

        put(b["prompt"], prompt)
        if b.get("seed") and "seed" in params:
            put(b["seed"], int(params["seed"]))
        if b.get("width"):
            put(b["width"], int(params["width"]))
        if b.get("height"):
            put(b["height"], int(params["height"]))
        if b.get("steps") and "steps" in params:
            put(b["steps"], int(params["steps"]))
        slots = b["images"]
        if len(images) > len(slots):
            raise RendererError("bad_input", f"This workflow takes {len(slots)} images.")
        for i, slot in enumerate(slots):
            if i < len(images):
                put(slot, images[i])
                continue
            by = slot.get("bypass")
            if not by:
                raise RendererError("bad_input", f"Image slot {i + 1} is required by this workflow.")
            through_id = self.node_by_title(g, by["rewire"]["from"])
            if through_id is None:
                raise RendererError("workflow_not_ready", f'Workflow node "{by["rewire"]["from"]}" is missing.')
            upstream = g[through_id]["inputs"].get(by["rewire"]["through"])
            removed = {self.node_by_title(g, t) for t in by["remove"]} - {None}
            for nid in removed:
                g.pop(nid, None)
            for node in g.values():
                for k, v in list(node.get("inputs", {}).items()):
                    if isinstance(v, list) and len(v) == 2 and v[0] in removed:
                        if v[0] == through_id:
                            node["inputs"][k] = upstream
                        else:
                            raise RendererError("workflow_not_ready", f"Removing image slot {i + 1} leaves a broken link; check the manifest.")
        out = self.node_by_title(g, b["output"]["title"])
        if out is None:
            raise RendererError("workflow_not_ready", "Workflow output node is missing.")
        return g, out


def load_workflows(folder: Path) -> dict[str, Workflow]:
    found: dict[str, Workflow] = {}
    if folder.exists():
        for m in sorted(folder.glob("*/manifest.json")):
            try:
                w = Workflow(m.parent)
                found[w.id] = w
            except (ValueError, KeyError) as e:
                print(f"Skipping {m.parent.name}: {e}", file=sys.stderr)
    return found


# ---------------------------------------------------------------------------------------
# ComfyUI adapter (the only engine adapter so far; others can implement the same methods)
# ---------------------------------------------------------------------------------------
class ComfyUI:
    kind = "comfyui"

    def __init__(self, base: str):
        if not is_loopback(base):
            raise SystemExit("For safety the renderer must be on this computer (127.0.0.1 / localhost).")
        self.base = base.rstrip("/")
        self.client_id = uuid.uuid4().hex

    def system(self) -> dict[str, Any] | None:
        try:
            s, d = http_json("GET", f"{self.base}/system_stats", timeout=5)
            return d if s == 200 else None
        except (OSError, urllib.error.URLError):
            return None

    def object_info(self) -> dict[str, Any] | None:
        try:
            s, d = http_json("GET", f"{self.base}/object_info", timeout=30)
            return d if s == 200 else None
        except (OSError, urllib.error.URLError):
            return None

    def upload(self, data: bytes, name: str) -> str:
        boundary = uuid.uuid4().hex
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + data + \
               (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n").encode()
        s, raw = http("POST", f"{self.base}/upload/image", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}, timeout=60)
        if s != 200:
            raise RendererError("renderer_error", f"ComfyUI didn't accept an input picture ({s}).")
        d = json.loads(raw)
        return f"{d['subfolder']}/{d['name']}" if d.get("subfolder") else d["name"]

    def submit(self, graph: dict[str, Any]) -> str:
        s, d = http_json("POST", f"{self.base}/prompt", {"prompt": graph, "client_id": self.client_id}, timeout=60)
        if s != 200 or "prompt_id" not in d:
            text = json.dumps(d.get("node_errors") or d.get("error") or d)[:600]
            if "not in list" in text or "value_not_in_list" in text:
                raise RendererError("missing_model", f"A model or file the workflow needs isn't installed: {text}")
            raise RendererError("workflow_not_ready", f"ComfyUI refused the workflow: {text}")
        return d["prompt_id"]

    def state(self, prompt_id: str) -> tuple[str, dict[str, Any]]:
        """('queued'|'running'|'done'|'error', details)."""
        s, h = http_json("GET", f"{self.base}/history/{prompt_id}", timeout=30)
        if s == 200 and prompt_id in (h or {}):
            item = h[prompt_id]
            st = item.get("status") or {}
            if st.get("status_str") == "error" or (st.get("completed") is False and st.get("status_str") not in (None, "success")):
                return "error", item
            return "done", item
        s, q = http_json("GET", f"{self.base}/queue", timeout=30)
        running = [x[1] for x in (q or {}).get("queue_running", []) if len(x) > 1]
        return ("running" if prompt_id in running else "queued"), {}

    def cancel(self, prompt_id: str) -> None:
        state, _ = self.state(prompt_id)
        if state == "queued":
            http_json("POST", f"{self.base}/queue", {"delete": [prompt_id]})
        elif state == "running":
            # Interrupt only if the running item is ours.
            http_json("POST", f"{self.base}/interrupt", {"prompt_id": prompt_id})

    def output(self, item: dict[str, Any], node_id: str) -> bytes:
        imgs = ((item.get("outputs") or {}).get(node_id) or {}).get("images") or []
        if not imgs:
            raise RendererError("renderer_error", "The workflow finished without a picture.")
        im = imgs[0]
        q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
        s, raw = http("GET", f"{self.base}/view?{q}", timeout=60)
        if s != 200:
            raise RendererError("renderer_error", "Couldn't read the finished picture from ComfyUI.")
        return raw


def error_code(item: dict[str, Any]) -> tuple[str, str]:
    msgs = json.dumps((item.get("status") or {}).get("messages") or [])
    low = msgs.lower()
    if "out of memory" in low or "outofmemory" in low or "allocation on device" in low:
        return "out_of_memory", "Your computer ran out of graphics memory. Try the Draft preset or a smaller size, close other apps, and generate again."
    if "not found" in low and ("model" in low or "safetensors" in low):
        return "missing_model", "A model file is missing. Run `python studio_renderer.py check` for details."
    return "renderer_error", f"The renderer stopped with an error: {msgs[:400]}"


def machine_report(comfy: ComfyUI, workflows: dict[str, Workflow]) -> dict[str, Any]:
    sysinfo = comfy.system()
    info = comfy.object_info() if sysinfo else None
    devices = (sysinfo or {}).get("devices") or []
    system = (sysinfo or {}).get("system") or {}
    return {
        "companionVersion": VERSION, "os": f"{platform.system()} {platform.release()}", "python": platform.python_version(),
        "rendererKind": comfy.kind, "rendererVersion": system.get("comfyui_version"), "rendererReachable": sysinfo is not None,
        "rendererError": None if sysinfo else f"ComfyUI isn't answering at {comfy.base}. Start ComfyUI, then this program checks again.",
        "backend": (devices[0].get("type") if devices else None),
        "gpus": [{"name": d.get("name", "?"), "vramTotalMb": round(d.get("vram_total", 0) / 2**20), "vramFreeMb": round(d.get("vram_free", 0) / 2**20)} for d in devices][:4],
        "ramTotalMb": round(system.get("ram_total", 0) / 2**20) or None,
        "workflows": [w.report(info) for w in workflows.values()],
    }


# ---------------------------------------------------------------------------------------
# Studio client
# ---------------------------------------------------------------------------------------
class Studio:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.cfg.token}"}

    def call(self, path: str, data: Any) -> Any:
        s, d = http_json("POST", f"{self.cfg.studio}{path}", data, self._h(), timeout=60)
        if s == 401:
            raise SystemExit(d.get("error") or "This computer isn't paired any more. Pair it again in Studio.")
        if s >= 400:
            raise RendererError("upload_failed" if "/output" in path or "/complete" in path else "renderer_error", (d or {}).get("error") or f"Studio answered {s}")
        return d


def validate_job(job: dict[str, Any], workflows: dict[str, Workflow], allow_http_loopback: bool = False) -> tuple[Workflow, dict[str, Any]]:
    wf = workflows.get(str(job.get("workflow")))
    if wf is None:
        raise RendererError("workflow_not_ready", f"This computer has no workflow called {job.get('workflow')!r}.")
    params = job.get("params") or {}
    m = wf.manifest
    out: dict[str, Any] = {}
    if m["params"].get("seed"):
        out["seed"] = int(params.get("seed", random.randint(0, 2**31 - 1))) % (2**53)
    size = m["sizes"]
    w, h = int(params.get("width", 0)), int(params.get("height", 0))
    for v in (w, h):
        if not (size["min"] <= v <= size["max"]) or v % size["multiple"]:
            raise RendererError("bad_input", f"Size {w}×{h} isn't supported by this workflow.")
    out["width"], out["height"] = w, h
    if m["params"].get("steps") and "steps" in params:
        out["steps"] = max(1, min(80, int(params["steps"])))
    prompt = str(job.get("prompt") or "")
    if not 1 <= len(prompt) <= 4000:
        raise RendererError("bad_input", "The shot description is empty or too long.")
    inputs = job.get("inputs") or []
    if not 1 <= len(inputs) <= len(m["bindings"]["images"]):
        raise RendererError("bad_input", f"This workflow takes 1 to {len(m['bindings']['images'])} pictures.")
    for i in inputs:
        url = str(i.get("url", ""))
        ok_url = url.startswith("https://") or (allow_http_loopback and url.startswith("http://") and is_loopback(url))
        if i.get("role") not in ROLES or not ok_url:
            raise RendererError("bad_input", "Unexpected input picture.")
    if sum(1 for i in inputs if i.get("role") in ("composition", "start_frame")) != 1 or inputs[0].get("role") not in ("composition", "start_frame"):
        raise RendererError("bad_input", "The first picture must be the composition or the earlier frame.")
    return wf, out


def run_job(job: dict[str, Any], studio: Studio, comfy: ComfyUI, workflows: dict[str, Workflow], cfg: Config, poll: float = 1.5, timeout_s: float = 1800) -> str:
    """Run one job end to end. Returns 'done', 'cancelled' or 'failed'."""
    jid = job["id"]
    def progress(stage: str, pct: float = 0, message: str = "") -> bool:
        return bool(studio.call(f"/api/renderer/jobs/{jid}/progress", {"stage": stage, "pct": pct, "message": message}).get("cancel"))
    try:
        wf, params = validate_job(job, workflows, cfg.data.get("allow_insecure_studio", False))
        problems = wf.check(comfy.object_info())
        if problems:
            raise RendererError("missing_model" if any("Model file" in p for p in problems) else "workflow_not_ready", "; ".join(problems[:4]))
        if progress("downloading", 5, f"Downloading {len(job['inputs'])} picture(s) for this frame"):
            raise RendererError("cancelled", "Stopped before starting.")
        names = []
        for k, inp in enumerate(job["inputs"]):
            s, data = http("GET", inp["url"], headers=inp.get("headers") or {}, timeout=120)
            if s != 200:
                raise RendererError("missing_input", f"Couldn't download input {k + 1} ({inp.get('role')}).")
            names.append(comfy.upload(data, f"studio_{jid[:8]}_{k + 1}.{'jpg' if inp.get('mime') == 'image/jpeg' else 'png'}"))
        graph, out_node = wf.build(job["prompt"], params, names)
        pid = comfy.submit(graph)
        started = time.time()
        while True:
            state, item = comfy.state(pid)
            if state == "done":
                break
            if state == "error":
                code, msg = error_code(item)
                raise RendererError(code, msg)
            if progress("generating" if state == "running" else "waiting", 50 if state == "running" else 10,
                        "Generating on this computer" if state == "running" else "Waiting for the renderer"):
                comfy.cancel(pid)
                raise RendererError("cancelled", "Stopped on your computer.")
            if time.time() - started > timeout_s:
                comfy.cancel(pid)
                raise RendererError("timeout", "Generation took too long and was stopped.")
            time.sleep(poll)
        png = comfy.output(item, out_node)
        local = cfg.results() / f"{jid}.png"
        local.write_bytes(png)
        meta = {"workflow_id": wf.id, "workflow_version": wf.version, "model": wf.manifest.get("model", ""), "renderer": comfy.kind,
                "renderer_version": (comfy.system() or {}).get("system", {}).get("comfyui_version", ""), "seed": params.get("seed", -1),
                "width": params["width"], "height": params["height"], "seconds": round(time.time() - started, 1), "companion": VERSION}
        (cfg.results() / f"{jid}.json").write_text(json.dumps({"job": jid, "meta": meta}))
        progress("uploading", 90, "Saving the picture to Studio")
        return upload_result(jid, local, meta, studio, cfg)
    except RendererError as e:
        studio.call(f"/api/renderer/jobs/{jid}/fail", {"code": e.code, "message": str(e)})
        return "cancelled" if e.code == "cancelled" else "failed"


def upload_result(jid: str, local: Path, meta: dict[str, Any], studio: Studio, cfg: Config) -> str:
    data = local.read_bytes()
    try:
        r = studio.call(f"/api/renderer/jobs/{jid}/output", {"mimeType": "image/png", "byteSize": len(data)})
        s, _ = http(r["upload"]["method"], r["upload"]["url"], data, r["upload"].get("headers") or {}, timeout=300)
        if s >= 300:
            raise RendererError("upload_failed", f"Upload answered {s}")
        studio.call(f"/api/renderer/jobs/{jid}/complete", {"assetId": r["assetId"], "meta": meta})
        pending = cfg.data.get("pending_uploads", [])
        if jid in pending:
            cfg.data["pending_uploads"] = [p for p in pending if p != jid]
            cfg.save()
        return "done"
    except (RendererError, OSError, urllib.error.URLError, KeyError) as e:
        cfg.data.setdefault("pending_uploads", [])
        if jid not in cfg.data["pending_uploads"]:
            cfg.data["pending_uploads"].append(jid)
        cfg.save()
        try:
            studio.call(f"/api/renderer/jobs/{jid}/fail", {"code": "upload_failed", "localFile": local.name,
                        "message": f"The picture was made and saved on your computer ({local.name}), but uploading it failed: {e}. It will be sent again automatically."})
        except (RendererError, OSError, urllib.error.URLError):
            pass
        return "failed"


def retry_uploads(studio: Studio, cfg: Config) -> None:
    for jid in list(cfg.data.get("pending_uploads", [])):
        local, meta_file = cfg.results() / f"{jid}.png", cfg.results() / f"{jid}.json"
        if local.exists():
            meta = json.loads(meta_file.read_text())["meta"] if meta_file.exists() else {}
            upload_result(jid, local, meta, studio, cfg)


# ---------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------
def cmd_pair(a: argparse.Namespace) -> None:
    cfg = Config(a.home)
    studio_url = check_studio_url(a.studio, a.allow_insecure_studio)
    comfy = ComfyUI(a.comfy)
    report = machine_report(comfy, load_workflows(a.workflows))
    s, d = http_json("POST", f"{studio_url}/api/renderer/pair", {"code": a.code, "name": a.name or socket.gethostname()[:80], "report": report})
    if s != 200:
        raise SystemExit(d.get("error") or f"Pairing failed ({s}).")
    cfg.data.update({"studio_url": studio_url, "comfy_url": comfy.base, "token": d["token"], "device_id": d["deviceId"],
                     "allow_insecure_studio": bool(a.allow_insecure_studio)})
    cfg.save()
    print(f"Paired. This computer is now connected to Studio ({studio_url}). Token saved in {cfg.path} (readable only by you).")


def cmd_check(a: argparse.Namespace) -> None:
    cfg = Config(a.home)
    comfy = ComfyUI(a.comfy or cfg.comfy)
    r = machine_report(comfy, load_workflows(a.workflows))
    print(json.dumps(r, indent=2))


def cmd_run(a: argparse.Namespace) -> None:
    cfg = Config(a.home)
    if not cfg.token:
        raise SystemExit("Not paired yet. In Studio: Storyboards → Connect Local Renderer, then run `pair`.")
    comfy = ComfyUI(a.comfy or cfg.comfy)
    studio = Studio(cfg)
    workflows = load_workflows(a.workflows)
    print(f"STUDIO Local Renderer {VERSION}: waiting for frames you submit in Studio. Press Ctrl+C to stop.")
    last_report = 0.0
    report: dict[str, Any] | None = None
    while True:
        try:
            if time.time() - last_report > 60 or report is None:
                report = machine_report(comfy, workflows)
                last_report = time.time()
            retry_uploads(studio, cfg)
            d = studio.call("/api/renderer/poll", {"report": report, "active": []})
            job = d.get("job")
            if job:
                print(f"Frame job {job['id'][:8]}: starting")
                print(f"Frame job {job['id'][:8]}: {run_job(job, studio, comfy, workflows, cfg)}")
                last_report = 0
                continue
            if a.once:
                return
            time.sleep(max(2, min(30, float(d.get("pollSeconds", 5)))))
        except (OSError, urllib.error.URLError) as e:
            print(f"Can't reach Studio right now ({e}). Trying again in 15 s.", file=sys.stderr)
            if a.once:
                return
            time.sleep(15)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="studio_renderer", description="STUDIO Local Renderer (companion).")
    p.add_argument("--home", type=Path, default=DEFAULT_HOME, help="where the token and results are kept")
    p.add_argument("--workflows", type=Path, default=HERE / "workflows")
    p.add_argument("--comfy", default=None, help="ComfyUI address on this computer (default http://127.0.0.1:8188)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("pair", help="connect this computer to Studio with a pairing code")
    s.add_argument("code")
    s.add_argument("--studio", required=True, help="Studio's address, e.g. https://studio-one-omega-46.vercel.app")
    s.add_argument("--name", default=None)
    s.add_argument("--allow-insecure-studio", action="store_true", help=argparse.SUPPRESS)
    sub.add_parser("check", help="show what this computer and its workflows can do (nothing is sent)")
    r = sub.add_parser("run", help="wait for frames submitted in Studio and generate them here")
    r.add_argument("--once", action="store_true", help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.cmd == "pair" and a.comfy is None:
        a.comfy = "http://127.0.0.1:8188"
    {"pair": cmd_pair, "check": cmd_check, "run": cmd_run}[a.cmd](a)


if __name__ == "__main__":
    main()
