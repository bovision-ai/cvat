// Copyright (C) Bovision Pty Ltd
//
// SPDX-License-Identifier: MIT

// Convert an interactor polygon (flat [x1,y1,x2,y2,...] in image px) into the minimum-area
// oriented box, expressed as CVAT wants a rotated rectangle: an axis-aligned rectangle
// [xtl,ytl,xbr,ybr] centred on the box, plus a clockwise `rotation` in degrees about that
// centre. Rotating calipers over the convex hull — no opencv dependency.
//
// Used to turn a single SAM/scissors click into an editable OBB the labeller tightens
// before save, instead of a lossy export-time mask->OBB conversion (which injects detector
// noise because nobody corrects the auto box).
export function polygonToObb(flat: number[]): { points: number[]; rotation: number } | null {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    if (pts.length < 3) return null;

    const cross = (o: number[], a: number[], b: number[]): number => (
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    );
    const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const lower: [number, number][] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: [number, number][] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (hull.length < 3) return null;

    let best: { area: number; cx: number; cy: number; w: number; h: number; angle: number } | null = null;
    for (let i = 0; i < hull.length; i++) {
        const [x1, y1] = hull[i];
        const [x2, y2] = hull[(i + 1) % hull.length];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len; const uy = (y2 - y1) / len; // edge direction
        const vx = -uy; const vy = ux; // edge normal
        let minu = Infinity; let maxu = -Infinity; let minv = Infinity; let maxv = -Infinity;
        for (const [px, py] of hull) {
            const du = px * ux + py * uy; const dv = px * vx + py * vy;
            if (du < minu) minu = du; if (du > maxu) maxu = du;
            if (dv < minv) minv = dv; if (dv > maxv) maxv = dv;
        }
        const w = maxu - minu; const h = maxv - minv; const area = w * h;
        if (best === null || area < best.area) {
            const cu = (minu + maxu) / 2; const cv = (minv + maxv) / 2;
            best = {
                area,
                cx: cu * ux + cv * vx,
                cy: cu * uy + cv * vy,
                w,
                h,
                angle: Math.atan2(uy, ux) * (180 / Math.PI),
            };
        }
    }
    if (best === null) return null;

    const {
        cx, cy, w, h, angle,
    } = best;
    return {
        points: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
        rotation: ((angle % 360) + 360) % 360,
    };
}
