export const TRACKING = {
  MIN_RED: 125,
  MIN_SAT: 70,
  MIN_VALUE: 105,
  RED_DOMINANCE: 35,
  MIN_PIXELS: 2,
  MAX_PIXELS: 700,
  SCAN_STEP: 2,
  MAX_CANDIDATES: 12,
  CONTINUITY_DISTANCE: 180,
  MIN_CONFIDENCE: .12
};

function isRed(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const value = Math.max(r, g, b);
  const saturation = value - Math.min(r, g, b);
  return r > TRACKING.MIN_RED && saturation > TRACKING.MIN_SAT && value > TRACKING.MIN_VALUE && r - g > TRACKING.RED_DOMINANCE && r - b > TRACKING.RED_DOMINANCE;
}

function candidateFrom(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, brightness = 0;
  points.forEach(point => {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y);
    brightness += point.value;
  });
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const area = Math.max(1, width * height);
  const compactness = Math.min(1, points.length / Math.max(1, area / (TRACKING.SCAN_STEP * TRACKING.SCAN_STEP)));
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  return { ...center, pixels: points.length, width, height, compactness, brightness: brightness / points.length };
}

function scoreCandidate(candidate, previous, maxDistance) {
  const brightnessScore = Math.min(1, candidate.brightness / 255);
  const compactnessScore = Math.min(1, candidate.compactness);
  const sizeScore = Math.min(1, candidate.pixels / 24);
  const continuityScore = previous ? Math.max(0, 1 - Math.hypot(candidate.x - previous.x, candidate.y - previous.y) / maxDistance) : .5;
  const score = previous
    ? continuityScore * .55 + brightnessScore * .2 + compactnessScore * .15 + sizeScore * .1
    : brightnessScore * .35 + compactnessScore * .4 + sizeScore * .25;
  return { ...candidate, score, confidence: Math.max(0, Math.min(1, score)) };
}

export function detect(image, w, h, quad, previous = null) {
  const d = image.data;
  const minX = Math.max(0, Math.floor(Math.min(...quad.map(p => p.x))));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...quad.map(p => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map(p => p.y))));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...quad.map(p => p.y))));
  const points = [];

  for (let y = minY; y <= maxY; y += TRACKING.SCAN_STEP) {
    for (let x = minX; x <= maxX; x += TRACKING.SCAN_STEP) {
      if (!inside({ x, y }, quad)) continue;
      const i = (y * w + x) * 4;
      if (isRed(d, i)) points.push({ x, y, value: Math.max(d[i], d[i + 1], d[i + 2]) });
    }
  }

  if (!points.length) return null;

  const pointMap = new Map(points.map(p => [`${p.x},${p.y}`, p]));
  const candidates = [];
  const visited = new Set();
  const step = TRACKING.SCAN_STEP;
  const neighbors = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => [dx * step, dy * step])).filter(([dx, dy]) => dx || dy);

  for (const point of points) {
    const key = `${point.x},${point.y}`;
    if (visited.has(key)) continue;
    const queue = [point], component = [];
    visited.add(key);
    while (queue.length) {
      const current = queue.pop();
      component.push(current);
      for (const [dx, dy] of neighbors) {
        const nextKey = `${current.x + dx},${current.y + dy}`;
        if (!pointMap.has(nextKey) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        const next = pointMap.get(nextKey);
        if (next) queue.push(next);
      }
    }
    if (component.length >= TRACKING.MIN_PIXELS && component.length <= TRACKING.MAX_PIXELS) {
      candidates.push(candidateFrom(component));
    }
    if (candidates.length >= TRACKING.MAX_CANDIDATES) break;
  }

  if (!candidates.length) return null;
  const ranked = candidates.map(candidate => scoreCandidate(candidate, previous, TRACKING.CONTINUITY_DISTANCE)).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best.confidence < TRACKING.MIN_CONFIDENCE) return { ...best, candidates: ranked };
  return { ...best, candidates: ranked };
}

function inside(p, q) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    s += ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0) ? 1 : -1;
  }
  return Math.abs(s) === 4;
}

// Solve the camera-quad → unit-rectangle homography on-device; no CV library is needed.
export function normalize(p, q) { const dst = [[0, 0], [1, 0], [1, 1], [0, 1]], a = []; for (let i = 0; i < 4; i++) { const { x, y } = q[i], [u, v] = dst[i]; a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]) } for (let col = 0; col < 8; col++) { let pivot = col; for (let r = col + 1; r < 8; r++)if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;[a[col], a[pivot]] = [a[pivot], a[col]]; const d = a[col][col]; if (Math.abs(d) < 1e-8) return { x: .5, y: .5 }; for (let j = col; j < 9; j++)a[col][j] /= d; for (let r = 0; r < 8; r++)if (r !== col) { const f = a[r][col]; for (let j = col; j < 9; j++)a[r][j] -= f * a[col][j] } } const h = a.map(r => r[8]); const z = h[6] * p.x + h[7] * p.y + 1; return { x: Math.max(0, Math.min(1, (h[0] * p.x + h[1] * p.y + h[2]) / z)), y: Math.max(0, Math.min(1, (h[3] * p.x + h[4] * p.y + h[5]) / z)) } }
