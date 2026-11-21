# STUDIO Local Renderer: setup guide

Generate storyboard frames **on your own computer**, guided by your Cast, Locations, Look & Feel and the composition you drew in Studio.

What stays true:

- **Generation happens on your computer.** It is not sent to a cloud image service. It still uses your graphics card, memory, electricity and time, and results vary from run to run.
- **The data path is explicit.** Your computer downloads the pictures chosen for the frame from Studio's storage. It generates the frame locally and keeps a copy in its `results` folder. Then it uploads the finished picture to Studio, where your film's normal access rules apply.
- **Studio never connects into your computer.** This program connects *out* to Studio over HTTPS. ComfyUI stays reachable only from your own computer (`127.0.0.1`). Studio can't send commands, file paths or workflow graphs, only values like the prompt text, seed, size, and which picture goes in which slot. Workflows run only if they are in your local `workflows/` folder.
- **Nothing is downloaded or installed for you.** You choose and download every program and model below.

> This setup has been tested only against simulated renderers (see "Tested so far"). The first real run on your computer is part of the acceptance steps below.

## What you need

| Item | Notes |
|---|---|
| A computer you're allowed to install programs on | Windows or Linux with an NVIDIA GPU is the most common ComfyUI setup. Apple Silicon Macs and AMD cards also run ComfyUI, but check ComfyUI's own install notes for your system. |
| Graphics memory | FLUX.2 [klein] 4B: Black Forest Labs says it fits in **about 13 GB of VRAM**. ComfyUI measured **8.4 GB** for the distilled 4B on an RTX 5090. With less memory, generation may fail with "out of memory". Studio reports this clearly and keeps your frame. |
| Disk space | Several GB for the model files. Check the sizes on each download page before downloading. |
| ComfyUI | Free and open source: <https://www.comfy.org/>. Use a recent version, since FLUX.2 [klein] support needs an up-to-date ComfyUI. |
| Python 3.9+ | ComfyUI already needs Python. This program uses only Python's standard library, so there's nothing extra to install. |
| Model: FLUX.2 [klein] 4B (distilled) | License **Apache-2.0**: <https://huggingface.co/black-forest-labs/FLUX.2-klein-4B>. Do not substitute the 9B or [dev] models unless you have checked their licenses, which are non-commercial. |

Reference pictures have their own rights. A picture in your Look & Feel isn't automatically licensed for every use. Studio carries each reference's credit and permission notes into the job record.

## 1. Install and start ComfyUI

Follow ComfyUI's official instructions for your system, then start it. It should open at `http://127.0.0.1:8188`.

Keep ComfyUI's default **listen address (127.0.0.1)**. Don't start it with `--listen 0.0.0.0`: that would expose it to your network, and Studio doesn't need it.

## 2. Load the official FLUX.2 [klein] template

In ComfyUI, open **Templates → Images → "Flux.2 Klein 4B & 9B"** and choose the **4B distilled image edit** template (`image_flux2_klein_image_edit_4b_distilled`). When ComfyUI asks for missing model files, read each file's size and license, then download them yourself.

Run the template once **inside ComfyUI** with any picture of your own to check that your computer can run it.

## 3. Add up to 4 picture inputs and name the parts Studio fills in

Studio sends **picture 1 = your composition** (or an earlier frame). Pictures 2–4 are cast, location and Look & Feel references, in that order of priority.

In the template, make sure there are four picture branches. Each branch is: *Load Image → (scale) → VAE Encode → ReferenceLatent*, with the ReferenceLatent nodes chained one after another. Duplicate a branch if the template has fewer.

Then **rename these nodes** (right-click → Title) exactly as follows:

| Title | Which node | Input Studio fills in |
|---|---|---|
| `STUDIO prompt` | the positive text-encode node | `text` |
| `STUDIO seed` | the random-noise / seed node | `noise_seed` |
| `STUDIO size` | the empty-latent (image size) node | `width`, `height` |
| `STUDIO image 1` … `STUDIO image 4` | the four Load Image nodes | `image` |
| `STUDIO scale 2` … `STUDIO scale 4` | the scale nodes of branches 2–4 (if present) | — |
| `STUDIO encode 2` … `STUDIO encode 4` | the VAE Encode nodes of branches 2–4 | — |
| `STUDIO ref 2` … `STUDIO ref 4` | the ReferenceLatent nodes of branches 2–4 | — |
| `STUDIO output` | the Save Image node | — |

When a frame has fewer pictures, this program removes the unused branches. It passes the chain through each removed ReferenceLatent's `conditioning` input. If your input names differ, adjust `workflows/flux2-klein-4b-refs/manifest.json`, then run `check`.

## 4. Export the workflow for this program

In ComfyUI: **Workflow → Export (API)**. Save the file as:

```
workflows/flux2-klein-4b-refs/graph.api.json
```

next to `studio_renderer.py`. The folder layout is:

```
studio-renderer/
  studio_renderer.py
  workflows/flux2-klein-4b-refs/manifest.json
  workflows/flux2-klein-4b-refs/graph.api.json   ← your export
```

Then check it. This sends nothing to Studio:

```
python studio_renderer.py check
```

You should see your GPU and memory, and `"ready": true` for the workflow. If a node title, node type or model file is missing, the output names it.

## 5. Pair with Studio

In Studio, go to **Storyboards → Connect Local Renderer → Make a pairing code**. Then run:

```
python studio_renderer.py pair <CODE> --studio https://studio-one-omega-46.vercel.app
```

The code works once, for 10 minutes. The device token is saved in `~/.studio-renderer/config.json`, readable only by you. Studio stores only a fingerprint (hash) of it. You can disconnect the computer from Studio at any time.

## 6. Run it while you work

```
python studio_renderer.py run
```

Leave it running. In Studio, choose a frame and press **Generate Locally**. One press makes one job. Nothing generates on its own: not when you upload, open a project, or change a setting. A failed job is never retried automatically.

- **Cancel:** a waiting job stops at once. For a running job, Studio asks your computer to stop. Your computer interrupts only its own job in ComfyUI. If your computer can't be reached, Studio stops waiting. If the picture finishes anyway, it is kept but not shown.
- **Out of memory / missing model:** the job fails with a clear message, and your frame, references and settings are unchanged.
- **Upload failed:** the picture stays in `~/.studio-renderer/results/` and is sent again automatically. It is never regenerated just to upload it.
- **Restart:** if this program or the computer restarts mid-job, that job is marked failed (once). Press Generate Locally again when you're ready.

## Acceptance on a real computer

1. `check` shows your GPU and memory, and the workflow is ready.
2. In Studio, Connect Local Renderer shows the computer as **Connected**, with the same GPU, memory and capabilities.
3. Pick a frame that has: a composition, **one** character with a picture, **one** location with a picture, and an approved Look & Feel direction with one image reference. Open Generate Locally and check the bundle list: picture 1 is the composition, then cast, location and look, each with its job.
4. Press **Generate Locally**. Watch the program print the job, and check that ComfyUI's queue shows it running on your computer.
5. When it finishes, the picture appears in the frame's results (if the frame isn't approved or locked). Check:
   - the character resembles the cast picture;
   - the setting resembles the location;
   - the style follows the Look & Feel picture's "use for" note, not its people or objects;
   - the layout follows your composition, and no stick figures remain.

   Write down what didn't hold. This model has no separate "style only" input, so roles are given in words.
6. **Cancel test:** start a Refine job and press Cancel while it runs. The program should report it stopped, and ComfyUI's queue should be empty.
7. **Memory test (optional):** choose Refine at the largest size. If memory runs out, you get the "out of memory" message and can generate again with Draft.
8. **Disconnect test:** stop the program while a job runs, start it again, and check that the job shows as failed once and nothing reruns by itself.
9. **Approved frames:** approve a frame, generate for it, and check that the frame still shows its approved picture. The new result waits in its history.

## Tested so far

Automated tests (`python -m unittest discover -s tests`) run this program against a **simulated** ComfyUI and a simulated Studio. They cover:

- pairing and keeping the token private;
- capability reports;
- binding values into the workflow, and removing unused picture branches;
- progress and cancel (interrupting only its own job);
- out of memory and missing models;
- upload failure with later resend, without regenerating;
- refusing unknown workflows, bad sizes, non-HTTPS inputs, and a renderer that isn't on this computer.

They do **not** test a real GPU, real model output, image quality, or generation time.

---

# STUDIO Mood Judge: "How {name} is doing", worked out on your computer

Each morning (about 4:17 AM New York time) Studio picks the news that reached each main character. That's their daily coverage. This program, running on **your** computer, compares that news with the character's rules ("How Johnny reacts"). For each headline and rule it decides one of three things:

- **in tune:** it would leave them calmer or happier;
- **at odds:** it would leave them more stressed or sadder;
- **unrelated.**

Every in tune or at odds call comes with a short reason. Studio then turns those judgments into the 0–10 score with its own fixed formula. Approved story events still nudge the score, and you can override any day.

What stays true:

- **Judging happens on your computer** through Ollama, with a free, open model. Headlines and rules go to Ollama on `127.0.0.1` only. No cloud AI service is used and no tokens are spent.
- **It only runs while this computer is on and the program is running.** Days wait in line until then, and each character's days are judged in order. A day that fails 3 times counts as a quiet day: no change except a slow drift back to the character's starting point.
- **Studio never connects into your computer.** This program connects *out* to Studio, the same way as the Local Renderer. A computer that's already paired doesn't need to pair again.

## What you need

| Item | Notes |
|---|---|
| A computer you're allowed to install programs on | Mac (Apple Silicon is best), Windows or Linux. Not a locked-down work computer. |
| Memory | 16 GB or more for an 8B model. With 8 GB, use a smaller model, such as `qwen3:4b`. |
| Ollama | Free: <https://ollama.com>. Install it and leave it running. It listens on `127.0.0.1:11434`. |
| A model | The default is **Qwen3 8B**, a reasoning model with an Apache-2.0 license: `ollama pull qwen3:8b` (about 5 GB). Other options: `qwen3:4b` (smaller), or `deepseek-r1:8b`. |
| Python 3.9+ | Standard library only; nothing extra to install. |

## Set up (once)

1. Install Ollama, then pull the model: `ollama pull qwen3:8b`
2. Copy `studio_judge.py` and `studio_renderer.py` into one folder.
3. Check that everything is ready (nothing is sent to Studio): `python studio_judge.py check`
4. If this computer isn't paired yet, open Studio → Storyboards → **Connect Local Renderer**. Make a pairing code, then run:
   `python studio_judge.py pair ABCDE23456 --studio https://studio-one-omega-46.vercel.app`
5. In Studio, open any main character's page. Under **How {name} is doing**, choose this computer as **Judged on**.
6. Start it: `python studio_judge.py run`. Leave it running. On a Mac you can keep it going after login with `nohup python3 studio_judge.py run &`.

To use another model, add `--model qwen3:4b` to `check` and `run`.

## Tested so far

Only against a fake Ollama and a fake Studio, in `tests/test_studio_judge.py`. Those tests cover:

- only an Ollama on this computer is accepted;
- judgments about headlines or rules that aren't in the job are dropped;
- a headline that tries to give instructions is treated as data;
- models without "thinking" are asked plainly;
- a bad answer hands the day back.

The first real run on your computer is the real acceptance test. Check that the reasons make sense for a few days, and override any score you disagree with.
