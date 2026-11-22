/* STUDIO trace worker: runs the trace pipeline off the main thread. Loads OpenCV.js and
 * ImageTracer.js from this site only when first needed. No network calls besides those
 * same-site files; no AI. Messages:
 *   in:  { type: "trace", id, data (ArrayBuffer RGBA), width, height, settings } | { type: "cancel", id }
 *   out: { type: "progress", id, stage, pct } | { type: "done", id, result } | { type: "error", id, message } */
var base = self.location.href.replace(/\/trace\/[^/]*$/, "/");
importScripts(base + "imagetracer/imagetracer.js", base + "trace/trace-pipeline.js");
var cvReady = null, latest = null;
function loadCv() {
  if (!cvReady) {
    cvReady = new Promise(function (ok, fail) {
      try {
        importScripts(base + "opencv/opencv.js");
        // The Emscripten module is a thenable that resolves to itself: never resolve a promise
        // with it directly. Wait until its runtime is ready (Mat exists), then box it.
        var t0 = Date.now();
        (function wait() {
          var c = self.cv;
          if (c && c.Mat) return ok({ cv: c });
          if (Date.now() - t0 > 45000) return fail(new Error("The tracing tools took too long to start."));
          setTimeout(wait, 20);
        })();
      } catch (e) { fail(e); }
    });
  }
  return cvReady;
}
self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === "cancel") { if (latest === m.id) latest = null; return; }
  if (m.type !== "trace") return;
  latest = m.id;
  self.postMessage({ type: "progress", id: m.id, stage: "loading", pct: 0.02 });
  loadCv().then(function (box) {
    var cv = box.cv;
    if (latest !== m.id) return self.postMessage({ type: "error", id: m.id, message: "cancelled" });
    var result = self.TracePipeline.trace(cv, self.ImageTracer, { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) }, m.settings,
      function (stage, pct) { self.postMessage({ type: "progress", id: m.id, stage: stage, pct: pct }); },
      function () { return latest !== m.id; });
    self.postMessage({ type: "done", id: m.id, result: result });
  }).catch(function (err) {
    self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
  });
};
