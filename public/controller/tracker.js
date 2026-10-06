export const TRACKING = {
  MIN_RED: 110,
  MIN_SAT: 25,
  MIN_VALUE: 90,
  RED_DOMINANCE: 18,
  OVEREXPOSED_VALUE: 220,
  OVEREXPOSED_RED_TOLERANCE: 18,
  MIN_LOCAL_CONTRAST: 14,
  MIN_RED_SCORE: 0.08,
  MIN_PIXELS: 1,
  MAX_PIXELS: 700,
  SCAN_STEP: 1,
  CONTINUITY_DISTANCE: 180,
  MIN_CONFIDENCE: .18
};

function pixelEvidence(d, i, w, h, x, y) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const value = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = value - min;
  const redExcess = Math.max(0, r - Math.max(g, b));
  const redRatio = redExcess / Math.max(1, g);
  const redScore = Math.max(0, Math.min(1, redExcess / 110));
  const redPurity = Math.max(0, Math.min(1, redRatio / 4));

  // A saturated red/pink pixel is the normal laser case. An overexposed
  // laser can become nearly white, so allow bright neutral pixels only when
  // they are a strong local hotspot.
  const saturatedRed =
    r >= TRACKING.MIN_RED &&
    saturation >= TRACKING.MIN_SAT &&
    value >= TRACKING.MIN_VALUE &&
    redExcess >= TRACKING.RED_DOMINANCE;

  const neutralHotspot =
    value >= TRACKING.OVEREXPOSED_VALUE &&
    r + TRACKING.OVEREXPOSED_RED_TOLERANCE >= g &&
    r + TRACKING.OVEREXPOSED_RED_TOLERANCE >= b;

  const sample = (sx, sy) => {
    const nx = Math.max(0, Math.min(w - 1, sx));
    const ny = Math.max(0, Math.min(h - 1, sy));
    const ni = (ny * w + nx) * 4;
    return Math.max(d[ni], d[ni + 1], d[ni + 2]);
  };

  const neighbors = (
    sample(x - 2, y) +
    sample(x + 2, y) +
    sample(x, y - 2) +
    sample(x, y + 2)
  ) / 4;
  const localContrast = Math.max(0, value - neighbors);

  if (!saturatedRed && !(neutralHotspot && localContrast >= TRACKING.MIN_LOCAL_CONTRAST)) {
    return null;
  }

  return {
    x,
    y,
    value,
    redScore,
    saturation,
    localContrast,
    // Weight red evidence more than raw brightness so large orange areas
    // cannot win merely by containing many bright pixels.
    redRatio,
    redPurity,
    laserScore: Math.min(
      1,
      redScore * .45 +
      redPurity * .25 +
      Math.min(1, localContrast / 100) * .20 +
      Math.min(1, saturation / 180) * .10
    )
  };
}

function candidateFrom(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let brightness = 0, redScore = 0, redPurity = 0, localContrast = 0, laserScore = 0;

  points.forEach(point => {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y);
    brightness += point.value;
    redScore += point.redScore;
    redPurity += point.redPurity;
    localContrast += point.localContrast;
    laserScore += point.laserScore;
  });

  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const area = Math.max(1, width * height);
  const compactness = Math.min(1, points.length / area);
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

  return {
    ...center,
    pixels: points.length,
    width,
    height,
    compactness,
    brightness: brightness / points.length,
    redScore: redScore / points.length,
    redPurity: redPurity / points.length,
    localContrast: localContrast / points.length,
    laserScore: laserScore / points.length
  };
}

function scoreCandidate(candidate, previous, maxDistance) {
  const brightnessScore = Math.min(1, candidate.brightness / 255);
  const compactnessScore = Math.min(1, candidate.compactness);
  const redScore = Math.min(1, candidate.redScore);
  const redPurity = Math.min(1, candidate.redPurity);
  const hotspotScore = Math.min(1, candidate.localContrast / 100);
  const laserScore = Math.min(1, candidate.laserScore);

  // Prefer small laser-like regions. A large region is intentionally not
  // rewarded for having more pixels.
  const sizeScore = candidate.pixels <= 24
    ? 1
    : Math.max(0, 1 - (candidate.pixels - 24) / Math.max(1, TRACKING.MAX_PIXELS - 24));

  const continuityScore = previous
    ? Math.max(0, 1 - Math.hypot(candidate.x - previous.x, candidate.y - previous.y) / maxDistance)
    : .5;

  const score = previous
    ? continuityScore * .25 +
      laserScore * .30 +
      redScore * .14 +
      redPurity * .06 +
      hotspotScore * .15 +
      brightnessScore * .07 +
      compactnessScore * .02 +
      sizeScore * .01
    : laserScore * .35 +
      redScore * .25 +
      hotspotScore * .18 +
      brightnessScore * .10 +
      compactnessScore * .07 +
      sizeScore * .05;

  return {
    ...candidate,
    score,
    confidence: Math.max(0, Math.min(1, score))
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
      const evidence = pixelEvidence(d, (y * w + x) * 4, w, h, x, y);
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

    const queue = [point], component = [];
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

    if (component.length >= TRACKING.MIN_PIXELS && component.length <= TRACKING.MAX_PIXELS) {
      candidates.push(candidateFrom(component));
    }
  }

  if (!candidates.length) return null;

  const ranked = candidates
    .map(candidate => scoreCandidate(candidate, previous, TRACKING.CONTINUITY_DISTANCE))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  // Confidence is deliberately applied here rather than only in the caller,
  // so low-quality candidates are explicitly reported as unreliable.
  if (best.confidence < TRACKING.MIN_CONFIDENCE) {
    return { ...best, reliable: false, candidates: ranked };
  }

  return { ...best, reliable: true, candidates: ranked };
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
