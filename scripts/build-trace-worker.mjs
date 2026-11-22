// Publish the browser tracing kit to public/vendor/ (run by prebuild):
//   opencv/opencv.js        OpenCV.js 4.12 (Apache-2.0), from @techstark/opencv-js
//   imagetracer/imagetracer.js  ImageTracer.js 1.2.6 (Unlicense / public domain)
//   trace/trace-worker.js, trace/trace-pipeline.js  STUDIO's worker (vendor-src/; the pipeline is .cjs so Node tests can require it)
// Everything runs in her browser; nothing here calls a model or another site.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = join("public", "vendor");
rmSync(out, { recursive: true, force: true });
for (const d of ["opencv", "imagetracer", "trace"]) mkdirSync(join(out, d), { recursive: true });
copyFileSync(join("node_modules", "@techstark", "opencv-js", "dist", "opencv.js"), join(out, "opencv", "opencv.js"));
copyFileSync(join("node_modules", "imagetracerjs", "imagetracer_v1.2.6.js"), join(out, "imagetracer", "imagetracer.js"));
copyFileSync(join("vendor-src", "trace-worker.js"), join(out, "trace", "trace-worker.js"));
copyFileSync(join("vendor-src", "trace-pipeline.cjs"), join(out, "trace", "trace-pipeline.js"));
console.log("Published the tracing kit (OpenCV.js, ImageTracer.js, STUDIO trace worker) to public/vendor/");
