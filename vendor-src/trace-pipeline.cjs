/* STUDIO trace pipeline: photo → editable vector paths, with no AI and no network.
 * Runs in a Web Worker (public/vendor/trace/trace-worker.js) and in Node tests.
 *   OpenCV.js (Apache-2.0)  — grayscale, contrast, smoothing, thresholds, Canny edges, morphology
 *   ImageTracer.js (public domain / Unlicense) — region tracing for Ink and Three-tone
 *   this file — edge linking + Douglas–Peucker for Outline (edges are pixels; this step makes
 *   them lines), path building, bounds.
 * Input: RGBA pixels (alpha < 128 = masked out / transparent → paper). Output: paths in pixel
 * units of the working image: { d, f (fill) | s (stroke) + w (width) }.
 * UMD: self.TracePipeline in a worker, module.exports in Node. */
(function (root) {
  "use strict";

  var LIMITS = { paths: 6000, chars: 2000000 };

  function clamp01(v, d) { v = Number(v); return isFinite(v) ? Math.min(1, Math.max(0, v)) : d; }
  function settingsOf(s) {
    s = s || {};
    return {
      treatment: s.treatment === "ink" || s.treatment === "three_tone" ? s.treatment : "outline",
      detail: clamp01(s.detail, 0.5), contrast: clamp01(s.contrast, 0.5), simplify: clamp01(s.simplify, 0.4), shadow: clamp01(s.shadow, 0.5),
      weight: Math.min(12, Math.max(0.5, Number(s.weight) || 2)),
      ink: /^#[0-9a-f]{6}$/i.test(s.ink || "") ? s.ink : "#111111",
      mid: /^#[0-9a-f]{6}$/i.test(s.mid || "") ? s.mid : "#8a8a8a",
    };
  }

  /** Two-threshold Otsu: the cuts that best split a histogram into dark / mid / light. */
  function otsu3(hist) {
    var P = new Float64Array(257), S = new Float64Array(257), i;
    for (i = 0; i < 256; i++) { P[i + 1] = P[i] + hist[i]; S[i + 1] = S[i] + i * hist[i]; }
    function part(a, b) { var w = P[b] - P[a]; return w > 0 ? (S[b] - S[a]) * (S[b] - S[a]) / w : 0; }
    var best = -1, t1 = 85, t2 = 170;
    for (var a = 1; a < 255; a++) for (var b = a + 1; b < 256; b++) {
      var v = part(0, a) + part(a, b) + part(b, 256);
      if (v > best) { best = v; t1 = a; t2 = b; }
    }
    return [t1, t2]; // values < t1 are dark, < t2 mid
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  /** Douglas–Peucker on a flat [x0,y0,x1,y1,...] list. */
  function simplifyLine(pts, eps) {
    var n = pts.length / 2;
    if (n < 3) return pts.slice();
    var keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
      var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9, best = -1, bd = 0;
      for (var i = a + 1; i < b; i++) {
        var d = Math.abs(dy * pts[i * 2] - dx * pts[i * 2 + 1] + bx * ay - by * ax) / len;
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0 && bd > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2], pts[k * 2 + 1]);
    return out;
  }

  /** Link 1-pixel edges (bin[i] != 0) into polylines: follow 8-connected neighbours, growing
   *  each chain both ways from its seed. Returns flat point lists in pixel centres. */
  function linkEdges(bin, w, h) {
    var seen = new Uint8Array(w * h), chains = [];
    var NX = [1, 0, -1, 0, 1, -1, -1, 1], NY = [0, 1, 0, -1, 1, 1, -1, -1];
    function grow(start) {
      var out = [], cur = start;
      for (;;) {
        var cx = cur % w, cy = (cur / w) | 0, next = -1;
        for (var k = 0; k < 8; k++) {
          var x = cx + NX[k], y = cy + NY[k];
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          var j = y * w + x;
          if (bin[j] && !seen[j]) { next = j; break; }
        }
        if (next < 0) return out;
        seen[next] = 1; out.push(next); cur = next;
      }
    }
    for (var i = 0; i < w * h; i++) {
      if (!bin[i] || seen[i]) continue;
      seen[i] = 1;
      var fwd = grow(i), back = grow(i), idx = back.reverse().concat([i], fwd), pts = new Array(idx.length * 2);
      for (var p = 0; p < idx.length; p++) { pts[p * 2] = (idx[p] % w) + 0.5; pts[p * 2 + 1] = ((idx[p] / w) | 0) + 0.5; }
      chains.push(pts);
    }
    return chains;
  }

  function lineLength(pts) {
    var L = 0;
    for (var i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return L;
  }

  function polylineD(pts) {
    var d = "M" + r1(pts[0]) + " " + r1(pts[1]);
    for (var i = 2; i < pts.length; i += 2) d += "L" + r1(pts[i]) + " " + r1(pts[i + 1]);
    return d;
  }

  /** One ImageTracer path (with its holes, reversed) as path data. */
  function tracedPathD(layer, smp) {
    var s = smp.segments, d = "M" + r1(s[0].x1) + " " + r1(s[0].y1), i;
    for (i = 0; i < s.length; i++) d += s[i].type + r1(s[i].x2) + " " + r1(s[i].y2) + (s[i].x3 !== undefined ? " " + r1(s[i].x3) + " " + r1(s[i].y3) : "");
    d += "Z";
    for (var h = 0; h < smp.holechildren.length; h++) {
      var hs = layer[smp.holechildren[h]].segments, last = hs[hs.length - 1];
      d += "M" + r1(last.x3 !== undefined ? last.x3 : last.x2) + " " + r1(last.x3 !== undefined ? last.y3 : last.y2);
      for (i = hs.length - 1; i >= 0; i--) d += hs[i].type + (hs[i].x3 !== undefined ? r1(hs[i].x2) + " " + r1(hs[i].y2) + " " : "") + r1(hs[i].x1) + " " + r1(hs[i].y1);
      d += "Z";
    }
    return d;
  }

  function regionsToPaths(IT, rgba, w, h, palette, colors, s) {
    var opts = {
      ltres: 0.5 + s.simplify * 3.5, qtres: 0.5 + s.simplify * 3.5,
      pathomit: Math.round(4 + (1 - s.detail) * 60), rightangleenhance: true,
      colorsampling: 0, numberofcolors: palette.length, mincolorratio: 0, colorquantcycles: 1,
      pal: palette, blurradius: 0, layering: 0, linefilter: true, scale: 1, roundcoords: 1,
    };
    var td = IT.imagedataToTracedata({ width: w, height: h, data: rgba }, opts), out = [];
    for (var l = 0; l < td.layers.length; l++) {
      var fill = colors[l];
      if (!fill) continue; // the paper layer stays empty: background is a separate colour
      var layer = td.layers[l];
      for (var p = 0; p < layer.length; p++) {
        if (layer[p].isholepath || layer[p].segments.length < 3) continue;
        out.push({ d: tracedPathD(layer, layer[p]), f: fill });
      }
    }
    return out;
  }

  /** The whole pipeline. cv = OpenCV.js, IT = ImageTracer. progress(stage, 0..1), cancelled() → bool. */
  function trace(cv, IT, input, settings, progress, cancelled) {
    var s = settingsOf(settings), w = input.width, h = input.height, mats = [];
    progress = progress || function () {};
    cancelled = cancelled || function () { return false; };
    function mat(m) { mats.push(m); return m; }
    function stop() { if (cancelled()) throw new Error("cancelled"); }
    try {
      progress("prepare", 0.05);
      var src = mat(cv.matFromImageData({ width: w, height: h, data: input.data }));
      var gray = mat(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      // Masked-out pixels become paper, so a cutout traces as a clean silhouette.
      var g = gray.data, a = input.data, n = w * h, i;
      for (i = 0; i < n; i++) if (a[i * 4 + 3] < 128) g[i] = 255;
      var alpha = 0.6 + s.contrast * 1.4;
      gray.convertTo(gray, -1, alpha, 128 * (1 - alpha));
      var soft = mat(new cv.Mat()), k = 1 + 2 * Math.round((1 - s.detail) * 3);
      cv.GaussianBlur(gray, soft, new cv.Size(k, k), 0);
      stop();
      var paths = [];

      if (s.treatment === "outline") {
        progress("edges", 0.25);
        var edges = mat(new cv.Mat()), hi = 220 - s.detail * 150, lo = hi * 0.45;
        cv.Canny(soft, edges, lo, hi);
        if (s.simplify > 0.35) {
          var ker = mat(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
          cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, ker);
          var thin = mat(new cv.Mat()); cv.Canny(edges, thin, 50, 150); // back to 1 px after closing gaps
          edges = thin;
        }
        stop();
        progress("lines", 0.55);
        var chains = linkEdges(edges.data, w, h), minLen = 6 + (1 - s.detail) * 36, eps = 0.6 + s.simplify * 3.4;
        for (i = 0; i < chains.length; i++) {
          if (lineLength(chains[i]) < minLen) continue;
          var pl = simplifyLine(chains[i], eps);
          if (pl.length >= 4) paths.push({ d: polylineD(pl), s: s.ink, w: s.weight });
        }
      } else if (s.treatment === "ink") {
        progress("shapes", 0.3);
        var bin = mat(new cv.Mat()), probe = mat(new cv.Mat());
        var otsu = cv.threshold(soft, probe, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        var t = Math.min(250, Math.max(5, otsu + (s.shadow - 0.5) * 120));
        cv.threshold(soft, bin, t, 255, cv.THRESH_BINARY_INV);
        var ks = 1 + 2 * Math.round(s.simplify * 3);
        if (ks > 1) {
          var kk = mat(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks, ks)));
          cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kk); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kk);
        }
        // Line weight for Ink: an explicit thickening (dilation) of the black shapes before tracing.
        var wk = Math.max(1, Math.round(s.weight));
        if (wk > 1) { var kd = mat(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wk, wk))); cv.dilate(bin, bin, kd); }
        stop();
        progress("trace", 0.55);
        var b = bin.data, rgba = new Uint8ClampedArray(n * 4);
        for (i = 0; i < n; i++) { var v = b[i] && a[i * 4 + 3] >= 128 ? 0 : 255; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
        paths = regionsToPaths(IT, rgba, w, h, [{ r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }], [null, s.ink], s);
      } else {
        progress("tones", 0.3);
        var mk = 3 + 2 * Math.round(s.simplify * 3), med = mat(new cv.Mat());
        cv.medianBlur(soft, med, mk);
        var md = med.data, hist = new Uint32Array(256), count = 0;
        for (i = 0; i < n; i++) if (a[i * 4 + 3] >= 128) { hist[md[i]]++; count++; }
        var cuts = otsu3(hist), shift = Math.round((s.shadow - 0.5) * 80);
        var cutDark = Math.min(254, Math.max(1, cuts[0] + shift)), cutMid = Math.min(255, Math.max(cutDark + 1, cuts[1] + shift));
        var rgb3 = new Uint8ClampedArray(n * 4);
        for (i = 0; i < n; i++) {
          var lv = a[i * 4 + 3] < 128 ? 255 : md[i] < cutDark ? 0 : md[i] < cutMid ? 128 : 255;
          rgb3[i * 4] = rgb3[i * 4 + 1] = rgb3[i * 4 + 2] = lv; rgb3[i * 4 + 3] = 255;
        }
        stop();
        progress("trace", 0.55);
        paths = regionsToPaths(IT, rgb3, w, h,
          [{ r: 255, g: 255, b: 255, a: 255 }, { r: 128, g: 128, b: 128, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }], [null, s.mid, s.ink], s);
      }
      stop();
      progress("finish", 0.95);
      var chars = 0;
      for (i = 0; i < paths.length; i++) chars += paths[i].d.length;
      var tooComplex = paths.length > LIMITS.paths || chars > LIMITS.chars;
      return { width: w, height: h, paths: tooComplex ? [] : paths, stats: { paths: paths.length, chars: chars }, tooComplex: tooComplex, settings: s };
    } finally {
      for (var m = 0; m < mats.length; m++) { try { mats[m].delete(); } catch (e) { /* already freed */ } }
    }
  }

  var api = { trace: trace, otsu3: otsu3, linkEdges: linkEdges, simplifyLine: simplifyLine, settingsOf: settingsOf, LIMITS: LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TracePipeline = api;
})(typeof self !== "undefined" ? self : globalThis);
