export const TRACKING = {
  MIN_RED: 110,
  RED_DOMINANCE: 30,
  MIN_SAT: 25,
  MIN_PIXELS: 1,
  MAX_PIXELS: 700,
  SCAN_STEP: 1,
  CONTINUITY_DISTANCE: 180,
  MIN_CONFIDENCE: .40,
  TRACKING_GRACE_FRAMES: 5
};

function pixelEvidence(d, i, x, y) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const value = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = value - min;
  const redDominance = r - Math.max(g, b);

  if (
    r < TRACKING.MIN_RED ||
    redDominance < TRACKING.RED_DOMINANCE ||
    saturation < TRACKING.MIN_SAT
  ) {
    return null;
  }

  return {
    x,
    y,
    redStrength: Math.min(1, r / 255),
    redDominance: Math.min(1, redDominance / 255)
  };
}

function candidateFrom(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let redStrength = 0, redDominance = 0;

  points.forEach(point => {
    x0 = Math.min(x0, point.x);
    x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y);
    y1 = Math.max(y1, point.y);
    redStrength += point.redStrength;
    redDominance += point.redDominance;
  });

  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const area = Math.max(1, width * height);
  const compactness = Math.min(1, points.length / area);

  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    pixels: points.length,
    width,
    height,
    compactness,
    redStrength: redStrength / points.length,
    redDominance: redDominance / points.length
  };
}

function scoreCandidate(candidate, previous, maxDistance) {
  const continuityScore = previous
    ? Math.max(
        0,
        1 - Math.hypot(candidate.x - previous.x, candidate.y - previous.y) / maxDistance
      )
    : .5;

  // Keep ranking intentionally simple: strong red first, continuity second,
  // with a small preference for compact regions.
  const score =
    candidate.redStrength * .50 +
    candidate.redDominance * .25 +
    continuityScore * .20 +
    candidate.compactness * .05;

  const redQuality = candidate.redStrength * .65 + candidate.redDominance * .25;
  const sizeQuality = Math.min(1, candidate.pixels / 4);
  const confidence = redQuality * .85 + sizeQuality * .15;

  return {
    ...candidate,
    score,
    confidence: Math.max(0, Math.min(1, confidence))
  };
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
      const evidence = pixelEvidence(d, (y * w + x) * 4, x, y);
      if (evidence) points.push(evidence);
    }
  }

  if (!points.length) return null;

  const pointMap = new Map(points.map(p => [`${p.x},${p.y}`, p]));
  const candidates = [];
  const visited = new Set();
  const step = TRACKING.SCAN_STEP;
  const neighbors = [-1, 0, 1]
    .flatMap(dx => [-1, 0, 1].map(dy => [dx * step, dy * step]))
    .filter(([dx, dy]) => dx || dy);

  for (const point of points) {
    const key = `${point.x},${point.y}`;
    if (visited.has(key)) continue;

    const queue = [point];
    const component = [];
    visited.add(key);

    while (queue.length) {
      const current = queue.pop();
      component.push(current);

      for (const [dx, dy] of neighbors) {
        const nextKey = `${current.x + dx},${current.y + dy}`;
        if (!pointMap.has(nextKey) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        queue.push(pointMap.get(nextKey));
      }
    }

    if (
      component.length >= TRACKING.MIN_PIXELS &&
      component.length <= TRACKING.MAX_PIXELS
    ) {
      candidates.push(candidateFrom(component));
    }
  }

  if (!candidates.length) return null;

  const ranked = candidates
    .map(candidate => scoreCandidate(candidate, previous, TRACKING.CONTINUITY_DISTANCE))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const reliable = best.confidence >= TRACKING.MIN_CONFIDENCE;

  return { ...best, reliable, candidates: ranked };
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
export function normalize(p, q) {
  const dst = [[0, 0], [1, 0], [1, 1], [0, 1]], a = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = q[i], [u, v] = dst[i];
    a.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v]
    );
  }

  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    if (Math.abs(d) < 1e-8) return { x: .5, y: .5 };

    for (let j = col; j < 9; j++) a[col][j] /= d;
    for (let r = 0; r < 8; r++) if (r !== col) {
      const f = a[r][col];
      for (let j = col; j < 9; j++) a[r][j] -= f * a[col][j];
    }
  }

  const h = a.map(r => r[8]);
  const z = h[6] * p.x + h[7] * p.y + 1;

  return {
    x: Math.max(0, Math.min(1, (h[0] * p.x + h[1] * p.y + h[2]) / z)),
    y: Math.max(0, Math.min(1, (h[3] * p.x + h[4] * p.y + h[5]) / z))
  };
}
