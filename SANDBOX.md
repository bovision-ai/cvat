# CVAT sandbox — custom-tool development

Fork of cvat-ai/cvat (→ github.com/bovision-ai/cvat), branch `feat/obb-4point-tool`,
based on **v2.67.0** (same as production). For building custom annotation tools
(e.g. the 4-point min-area OBB tool) WITHOUT touching the production stack that
Hanja's team uses at https://label.bovision.com.au.

## Isolation from prod (critical)

Production runs as compose project **`cvat`**: containers `cvat_*`, volumes
`cvat_cvat_data`/`cvat_cvat_keys`/db, and traefik owning host ports 80/443/8080/8090.

The sandbox MUST run as a different compose project (`cvat_sandbox`, via `sandbox.env`)
so Docker prefixes its containers/volumes/networks separately — prod's data and
containers are never shared or overwritten. The sandbox also must NOT bind 80/443/
8080/8090. Reach the sandbox UI over an SSH tunnel instead of exposing it publicly.

## The one real risk: building cvat-ui from source

`cvat-ui` is a large webpack build that can spike to 4–6 GB RAM. The box has ~10 GB
free while prod runs, and Hanja is actively labelling, so an unbounded build could
trigger the OOM killer and take down prod containers (we OOM'd a process here once).

Mitigations (do NOT skip):
- Memory-cap the build container: `docker build --memory=6g --memory-swap=6g ...`
  so a runaway build is killed by its own cgroup, not the global OOM killer.
- Build when Hanja is offline (Indonesia/WIB evening) and watch prod with
  `docker stats` / the Monitor; abort if prod workers approach the RAM ceiling.
- Or build on a separate throwaway box and just run the resulting image here.

## Where to run it — decide before building

- **Separate small EC2 box (recommended):** zero risk to prod. Build + run the full
  sandbox there. Costs a few $/day; tear down when the tool's done.
- **Same box, carefully:** feasible with the memory cap above + building during
  Hanja's off-hours. Higher risk; only if a separate box isn't wanted.

## Custom tool target (parked feature)

4-point → minimum-area OBB draw tool. Touch points (verified in source):
- `cvat-canvas/src/typescript/drawHandler.ts` — existing `EXTREME_POINTS` ("By 4
  points") builds an axis-aligned rect; add a variant that runs minAreaRect over the
  4 clicks and emits a rectangle + `rotation` angle.
- `cvat-ui` — expose the new draw mode in the rectangle draw controls.
- Rebuild the `cvat/ui` image from this branch; run it in the sandbox stack only.
