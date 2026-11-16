"""Companion tests against a fake ComfyUI and a fake Studio (no GPU, no network).

These check the adapter's behavior: pairing, capability reports, allowlisted workflows,
binding/bypass, progress, cancel, out-of-memory, missing models, upload failure recovery,
and refusing anything that isn't loopback/allowlisted. They are NOT a test of image quality
or of a real renderer; see README "Acceptance on a real computer".
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import studio_renderer as sr  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
FIX = Path(__file__).resolve().parent / "fixtures" / "workflows"


class Fake:
    """Shared state for both fake servers."""
    def __init__(self):
        self.reset()

    def reset(self):
        self.prompts = {}
        self.polls_until_done = 1
        self.mode = "ok"          # ok | oom | refuse_model
        self.installed = ["model-a.safetensors"]
        self.interrupts = []
        self.deleted = []
        self.uploads_to_comfy = []
        self.jobs = []
        self.events = []
        self.cancel = False
        self.storage_fail = 0
        self.stored = {}
        self.completed = []
        self.paired = []


F = Fake()


def handler_for(kind):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def send(self, code, data, ctype="application/json"):
            raw = data if isinstance(data, bytes) else json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        # ---- ComfyUI ----
        def comfy_get(self):
            p = self.path
            if p == "/system_stats":
                return self.send(200, {"system": {"os": "posix", "comfyui_version": "0.9.0", "ram_total": 32 * 2**30},
                                       "devices": [{"name": "Fake GPU", "type": "cuda", "vram_total": 12 * 2**30, "vram_free": 10 * 2**30}]})
            if p == "/object_info":
                return self.send(200, {
                    "Loader": {"input": {"required": {"unet_name": [F.installed]}}},
                    "Text": {"input": {"required": {"text": ["STRING"], "clip": ["CLIP"]}}},
                    "LoadImage": {"input": {"required": {"image": [["x.png"]]}}},
                    "Encode": {"input": {"required": {"pixels": ["IMAGE"]}}},
                    "Ref": {"input": {"required": {"conditioning": ["CONDITIONING"], "latent": ["LATENT"]}}},
                    "Noise": {"input": {"required": {"noise_seed": ["INT"]}}},
                    "Latent": {"input": {"required": {"width": ["INT"], "height": ["INT"]}}},
                    "Sample": {"input": {"required": {}}},
                    "Save": {"input": {"required": {"images": ["IMAGE"]}}},
                })
            if p.startswith("/history/"):
                pid = p.split("/")[-1]
                st = F.prompts.get(pid)
                if st is None or st["polls"] < F.polls_until_done:
                    if st is not None:
                        st["polls"] += 1
                    return self.send(200, {})
                if F.mode == "oom":
                    return self.send(200, {pid: {"status": {"status_str": "error", "completed": False,
                                                            "messages": [["execution_error", {"exception_message": "CUDA out of memory"}]]}}})
                return self.send(200, {pid: {"status": {"status_str": "success", "completed": True},
                                             "outputs": {st["out"]: {"images": [{"filename": "o.png", "subfolder": "", "type": "output"}]}}}})
            if p == "/queue":
                running = [[0, pid] for pid, st in F.prompts.items() if st["polls"] < F.polls_until_done]
                return self.send(200, {"queue_running": running[:1], "queue_pending": running[1:]})
            if p.startswith("/view"):
                return self.send(200, PNG, "image/png")
            self.send(404, {})

        def comfy_post(self):
            b = self.body()
            if self.path == "/upload/image":
                F.uploads_to_comfy.append(len(b))
                return self.send(200, {"name": f"in{len(F.uploads_to_comfy)}.png", "subfolder": "", "type": "input"})
            if self.path == "/prompt":
                g = json.loads(b)["prompt"]
                if F.mode == "refuse_model":
                    return self.send(400, {"error": "invalid", "node_errors": {"1": "Value not in list: unet_name"}})
                pid = f"p{len(F.prompts) + 1}"
                out = next(k for k, v in g.items() if v["class_type"] == "Save")
                F.prompts[pid] = {"graph": g, "polls": 0, "out": out}
                return self.send(200, {"prompt_id": pid, "number": 1})
            if self.path == "/interrupt":
                F.interrupts.append(json.loads(b or b"{}"))
                return self.send(200, {})
            if self.path == "/queue":
                F.deleted.append(json.loads(b))
                return self.send(200, {})
            self.send(404, {})

        # ---- Studio ----
        def studio_post(self):
            b = json.loads(self.body() or b"null")
            auth = self.headers.get("Authorization", "")
            if self.path == "/api/renderer/pair":
                if b["code"] != "ABCDEFGHJK":
                    return self.send(400, {"error": "bad code"})
                F.paired.append(b)
                return self.send(200, {"token": "srt_" + "t" * 43, "deviceId": "dev-1"})
            if auth != "Bearer srt_" + "t" * 43:
                return self.send(401, {"error": "not paired"})
            if self.path == "/api/renderer/poll":
                F.events.append(("poll", b))
                return self.send(200, {"job": F.jobs.pop(0) if F.jobs else None, "pollSeconds": 2})
            parts = self.path.split("/")
            jid, action = parts[4], parts[5]
            F.events.append((action, b))
            if action == "progress":
                return self.send(200, {"cancel": F.cancel})
            if action == "output":
                return self.send(200, {"assetId": f"asset-{jid}", "upload": {"url": f"{STUDIO}/storage/{jid}", "method": "PUT", "headers": {"Content-Type": "image/png"}}})
            if action == "complete":
                F.completed.append((jid, b))
                return self.send(200, {"ok": True, "shown": True})
            if action == "fail":
                return self.send(200, {"ok": True})
            self.send(404, {})

        def do_GET(self):
            if kind == "comfy":
                return self.comfy_get()
            if self.path.startswith("/files/"):
                return self.send(200, PNG, "image/png")
            self.send(404, {})

        def do_POST(self):
            return self.comfy_post() if kind == "comfy" else self.studio_post()

        def do_PUT(self):
            data = self.body()
            if F.storage_fail > 0:
                F.storage_fail -= 1
                return self.send(503, {})
            F.stored[self.path] = data
            self.send(200, b"", "text/plain")
    return H


def serve(kind):
    s = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(kind))
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f"http://127.0.0.1:{s.server_address[1]}"


COMFY_SRV, COMFY = serve("comfy")
STUDIO_SRV, STUDIO = serve("studio")


def job(n=2, jid="00000000-0000-4000-8000-00000000000a", **extra):
    roles = ["composition", "cast", "location", "look"][:n]
    j = {"id": jid, "workflow": "fake-refs", "prompt": "Turn image 1 into a finished frame.",
         "params": {"seed": 42, "width": 768, "height": 432},
         "inputs": [{"role": r, "assetId": f"a{k}", "mime": "image/png", "url": f"{STUDIO}/files/a{k}"} for k, r in enumerate(roles)]}
    j.update(extra)
    return j


class CompanionTests(unittest.TestCase):
    def setUp(self):
        F.reset()
        self.home = Path(tempfile.mkdtemp())
        self.wfs = sr.load_workflows(FIX)
        sr.main(["--home", str(self.home), "--workflows", str(FIX), "--comfy", COMFY, "pair", "ABCDEFGHJK", "--studio", STUDIO, "--allow-insecure-studio", "--name", "Test PC"])
        self.cfg = sr.Config(self.home)
        self.studio = sr.Studio(self.cfg)
        self.comfy = sr.ComfyUI(COMFY)

    def run_job(self, j):
        return sr.run_job(j, self.studio, self.comfy, self.wfs, self.cfg, poll=0.01)

    def test_pairing_reports_hardware_and_keeps_token_private(self):
        rep = F.paired[0]["report"]
        self.assertEqual(rep["gpus"][0]["name"], "Fake GPU")
        self.assertEqual(rep["gpus"][0]["vramTotalMb"], 12288)
        self.assertEqual(rep["backend"], "cuda")
        self.assertTrue(rep["workflows"][0]["ready"], rep["workflows"][0]["problems"])
        self.assertEqual(rep["workflows"][0]["maxImages"], 3)
        if os.name == "posix":
            self.assertEqual(oct((self.home / "config.json").stat().st_mode & 0o777), "0o600")

    def test_full_job_binds_values_and_uploads_result(self):
        self.assertEqual(self.run_job(job(3)), "done")
        g = F.prompts["p1"]["graph"]
        titles = {v["_meta"]["title"]: v for v in g.values()}
        self.assertEqual(titles["STUDIO prompt"]["inputs"]["text"], "Turn image 1 into a finished frame.")
        self.assertEqual(titles["STUDIO seed"]["inputs"]["noise_seed"], 42)
        self.assertEqual((titles["STUDIO size"]["inputs"]["width"], titles["STUDIO size"]["inputs"]["height"]), (768, 432))
        self.assertEqual(titles["STUDIO image 3"]["inputs"]["image"], "in3.png")
        jid, body = F.completed[0]
        self.assertEqual(body["meta"]["workflow_id"], "fake-refs")
        self.assertEqual(body["meta"]["seed"], 42)
        self.assertEqual(list(F.stored.values())[0], PNG)
        self.assertTrue((self.cfg.results() / f"{jid}.png").exists(), "a local copy is kept")

    def test_unused_slots_are_removed_and_links_passed_through(self):
        self.assertEqual(self.run_job(job(1)), "done")
        g = F.prompts["p1"]["graph"]
        titles = {v["_meta"]["title"] for v in g.values()}
        self.assertNotIn("STUDIO image 2", titles)
        self.assertNotIn("STUDIO ref 3", titles)
        sampler = next(v for v in g.values() if v["class_type"] == "Sample")
        self.assertEqual(sampler["inputs"]["positive"], ["10", 0], "rewired to the first reference")

    def test_cancel_stops_on_this_computer(self):
        F.polls_until_done = 50
        F.cancel = True
        self.assertEqual(self.run_job(job(1)), "cancelled")
        fails = [b for a, b in F.events if a == "fail"]
        self.assertEqual(fails[-1]["code"], "cancelled")

    def test_cancel_while_generating_interrupts_only_our_prompt(self):
        F.polls_until_done = 50
        def flip(*a, **k):
            F.cancel = True
        orig = self.comfy.submit
        self.comfy.submit = lambda g: (flip(), orig(g))[1]
        self.assertEqual(self.run_job(job(1)), "cancelled")
        self.assertEqual(F.interrupts, [{"prompt_id": "p1"}])

    def test_out_of_memory_is_a_clear_recoverable_error(self):
        F.mode = "oom"
        self.assertEqual(self.run_job(job(1)), "failed")
        fail = [b for a, b in F.events if a == "fail"][-1]
        self.assertEqual(fail["code"], "out_of_memory")
        self.assertIn("Draft", fail["message"])

    def test_missing_model_is_reported_before_generating(self):
        F.installed = []
        self.assertEqual(self.run_job(job(1)), "failed")
        fail = [b for a, b in F.events if a == "fail"][-1]
        self.assertEqual(fail["code"], "missing_model")
        self.assertEqual(F.prompts, {}, "nothing was submitted")

    def test_upload_failure_keeps_result_and_resends_without_regenerating(self):
        F.storage_fail = 1
        self.assertEqual(self.run_job(job(1)), "failed")
        fail = [b for a, b in F.events if a == "fail"][-1]
        self.assertEqual(fail["code"], "upload_failed")
        self.assertEqual(fail["localFile"], f"{job()['id']}.png")
        self.assertIn(job()["id"], sr.Config(self.home).data["pending_uploads"])
        sr.retry_uploads(self.studio, self.cfg)
        self.assertEqual(len(F.prompts), 1, "not generated again")
        self.assertEqual(len(F.completed), 1)
        self.assertEqual(sr.Config(self.home).data["pending_uploads"], [])

    def test_refuses_unknown_workflow_bad_sizes_and_non_https_inputs(self):
        self.assertEqual(self.run_job(job(1, workflow="rm -rf /")), "failed")
        self.assertEqual([b for a, b in F.events if a == "fail"][-1]["code"], "workflow_not_ready")
        self.assertEqual(self.run_job(job(1, params={"seed": 1, "width": 770, "height": 432})), "failed")
        self.assertEqual([b for a, b in F.events if a == "fail"][-1]["code"], "bad_input")
        bad = job(1)
        bad["inputs"][0]["url"] = "http://example.com/x.png"
        self.assertEqual(self.run_job(bad), "failed")
        self.assertEqual(F.prompts, {})

    def test_renderer_must_be_on_this_computer(self):
        with self.assertRaises(SystemExit):
            sr.ComfyUI("http://192.168.1.20:8188")

    def test_check_reports_missing_graph_titles(self):
        w = self.wfs["fake-refs"]
        g = w.graph
        w.graph = {k: v for k, v in g.items() if v["_meta"]["title"] != "STUDIO seed"}
        self.assertTrue(any("STUDIO seed" in p for p in w.check(self.comfy.object_info())))
        w.graph = g


if __name__ == "__main__":
    unittest.main()
