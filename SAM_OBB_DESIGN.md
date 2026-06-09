# Single-click SAM → OBB tool — deployment & mask→OBB design

Goal: labeller clicks a cow once → tight oriented bounding box appears. Validate the
labelling-efficiency gain cheaply before committing to always-on GPU spend.

## How CVAT's SAM actually works (drives the whole design)

CVAT splits SAM in two:
- **Image encoder** runs as a **nuclio serverless function on a GPU** — heavy, run once
  per image, returns an embedding (`blob`). This is `serverless/pytorch/facebookresearch/
  sam/nuclio/` (ships in our v2.67.0 Community tree; SAM2/3 are Online/Enterprise/newer).
- **Mask decoder** runs **in the browser** (ONNX) on each click — light, interactive,
  no per-click GPU round-trip. It turns clicks → a mask → a **polygon** shape in CVAT.

Implication: the GPU only does the encode. The mask (and therefore the OBB conversion)
lives client-side or downstream — NOT in the nuclio function.

## Topology

    [GPU instance — your training box]            [this box — CVAT, CPU]
      nuclio + SAM ViT-H encoder (GPU)   <----     cvat_server / sandbox UI
      exposed on :8070 (nuclio gateway)            serverless enabled, points at GPU nuclio
                                                   browser runs SAM decoder on clicks

CVAT here stays CPU-only; only the SAM encoder needs the GPU. CVAT calls the remote
nuclio endpoint for the embedding.

## Deploy steps (on the GPU box)

1. Prereqs: NVIDIA driver + nvidia-container-toolkit, Docker, CUDA-capable GPU
   (ViT-H SAM encoder ≈ 7–8 GB VRAM; a T4/L4/A10 is plenty).
2. Install nuclio CLI + dashboard:
       wget .../nuctl-<ver>-linux-amd64 -O /usr/local/bin/nuctl && chmod +x ...
       # nuclio dashboard container, or `nuctl deploy` directly
3. Deploy the SAM encoder function from the CVAT repo (this branch has it):
       cd cvat
       ./serverless/deploy_gpu.sh serverless/pytorch/facebookresearch/sam/
   (builds image `cvat.pth.facebookresearch.sam.vit_h:latest-gpu`, requests
   `nvidia.com/gpu: 1`; downloads the SAM ViT-H checkpoint ~2.5 GB on first build).
4. Expose the nuclio gateway (default :8070) to this CVAT box (security group / tunnel /
   private networking — keep it off the public internet).

## Wire CVAT (this box) to the remote nuclio

CVAT enables AI Tools via the serverless compose overlay + a nuclio host it can reach:
- bring the stack up with `docker-compose.serverless.yml` (adds the nuclio gateway wiring),
  and set the nuclio host/port to the GPU box's gateway instead of a local one.
- confirm: `GET /api/lambda/functions` returns the `sam` function (today it 503s — AI Tools off).
- In the UI: right panel → AI Tools → Interactors → Segment Anything → click the cow.

For the sandbox specifically: run the sandbox stack (cvat_sandbox) with the serverless
overlay pointed at the GPU nuclio, so we test against prod-isolated data.

## The mask → OBB step — two placements

The decoder gives a **polygon** (mask contour). Turning it into a min-area OBB is one
`cv2.minAreaRect`. Where it goes depends on how far you want to take it:

### Path 1 — No fork (pilot): convert at export
Labellers SAM-click → polygon shapes. Convert polygon → OBB when exporting for training.
Zero CVAT changes; proves the SAM speedup immediately. Labeller sees a polygon, not a
rotated box (acceptable for a pilot). The conversion (drop into export_labelled_to_s3.py):

```python
import cv2, numpy as np

def polygon_to_yolo_obb(points_xy, img_w, img_h, cls=0):
    """CVAT polygon (flat [x1,y1,x2,y2,...] px) -> YOLO-OBB line (normalised 4 corners)."""
    pts = np.array(points_xy, dtype=np.float32).reshape(-1, 2)
    rect = cv2.minAreaRect(pts)            # ((cx,cy),(w,h),angle)
    box = cv2.boxPoints(rect)              # 4 corners (x,y), px
    box[:, 0] /= img_w; box[:, 1] /= img_h # normalise
    coords = " ".join(f"{v:.6f}" for v in box.flatten())
    return f"{cls} {coords}"
```
(That emits the exact 9-value row our detector trains on.)

### Path 2 — Frontend fork (the real "single-click OBB"): convert in-canvas
Make the box appear rotated on click. In `cvat-canvas` (the SAM/interactor draw path),
after the decoder yields the mask contour, run minAreaRect and emit a **rotated rectangle**
shape (rectangle + `rotation` angle) instead of a polygon. Then it's a native CVAT OBB —
editable in-canvas, and CVAT's own YOLO-OBB export works with no conversion step.
Cost: cvat-canvas/cvat-ui edit + rebuild the `cvat-sandbox-ui` image (we've proven that
build works here, heap-capped). Same minAreaRect math, just in TypeScript.

## Recommended order

1. **Pilot (Path 1):** SAM encoder on the GPU box + this CVAT, click-to-polygon, convert
   at export. Measure **minutes-per-job with vs without SAM** on a few real jobs.
2. If the gain justifies it, build **Path 2** in the sandbox (in-canvas OBB) and, separately,
   decide on always-on GPU. If the gain is marginal (likely, since the detector already
   pre-labels most cows — SAM mainly helps *missed* ones), stop after the pilot.

## Reality check to keep front-of-mind

The detector already lays down ~110–180 boxes/frame; labellers mostly **correct** (delete
spurious, fix rotation). SAM one-click only speeds **adding missed cows** — a minority that
shrinks as the retrain loop improves the detector. Measure before investing in the fork or
a dedicated GPU.
