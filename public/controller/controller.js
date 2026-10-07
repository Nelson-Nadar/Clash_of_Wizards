import { CONFIG } from '../game/config.js';
import { TRACKING, detect, normalize } from './tracker.js';

const video = document.querySelector('#camera');
const canvas = document.querySelector('#overlay');
const context = canvas.getContext('2d', { willReadFrequently: true });
const $ = selector => document.querySelector(selector);
const CORNER_PADDING = 24;
const MIN_RECT_SIZE = 80;
let ws, points, drag = -1, calibrating = false, lastTransmission = 0, calibrationDirty = false, previousDetection = null, missedFrames = 0;
let dragStart = null;
const DEBUG = CONFIG.DEBUG;

function defaultPoints() {
  return [
    { x: canvas.width * .14, y: canvas.height * .14 },
    { x: canvas.width * .86, y: canvas.height * .14 },
    { x: canvas.width * .86, y: canvas.height * .86 },
    { x: canvas.width * .14, y: canvas.height * .86 }
  ];
}

function constrain(point) {
  return {
    x: Math.max(CORNER_PADDING, Math.min(canvas.width - CORNER_PADDING, point.x)),
    y: Math.max(CORNER_PADDING, Math.min(canvas.height - CORNER_PADDING, point.y))
  };
}

function constrainPoints() {
  points = points.map(constrain);
}

function sendCalibration() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'calibration', points }));
    calibrationDirty = false;
  } else {
    calibrationDirty = true;
  }
}

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', role: 'controller' }));
    if (calibrationDirty && points) sendCalibration();
    $('#connection').textContent = '● Connected';
  };
  ws.onclose = () => {
    $('#connection').textContent = '● Reconnecting';
    setTimeout(connect, 1000);
  };
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state' && message.state.calibration && !points) {
      points = message.state.calibration;
      if (canvas.width && canvas.height) constrainPoints();
    }
  };
}

function resize() {
  const oldWidth = canvas.width;
  const oldHeight = canvas.height;

  canvas.width = innerWidth;
  canvas.height = innerHeight;

  if (!points) {
    points = defaultPoints();
  } else if (oldWidth && oldHeight) {
    const scaleX = canvas.width / oldWidth;
    const scaleY = canvas.height / oldHeight;
    points = points.map(point => ({
      x: point.x * scaleX,
      y: point.y * scaleY
    }));
    constrainPoints();
  } else {
    constrainPoints();
  }

}
addEventListener('resize', resize);
resize();
connect();

$('#cameraBtn').onclick = async () => {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    await video.play();
    resize();
    requestAnimationFrame(loop);
    $('#cameraBtn').classList.add('hidden');
  } catch (error) {
    $('#tracking').textContent = 'Camera permission denied';
  }
};

$('#calibrate').onclick = () => {
  calibrating = !calibrating;
  $('#save').classList.toggle('hidden', !calibrating);
  $('#calibrate').textContent = calibrating ? 'Cancel' : 'Calibrate';
};

$('#save').onclick = () => {
  constrainPoints();
  sendCalibration();
  calibrating = false;
  drag = -1;
  dragStart = null;
  $('#save').classList.add('hidden');
  $('#calibrate').textContent = 'Calibrate';
};

$('#resetBorder').onclick = () => {
  // Reset both the displayed and persisted rectangle so an unusable saved
  // calibration cannot immediately overwrite the reset state.
  points = defaultPoints();
  calibrating = true;
  drag = -1;
  dragStart = null;
  sendCalibration();
  $('#save').classList.remove('hidden');
  $('#calibrate').textContent = 'Cancel';
};

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return constrain({
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  });
}

function applyCornerDrag(point) {
  const start = dragStart.points;
  const dx = point.x - dragStart.pointer.x;
  const dy = point.y - dragStart.pointer.y;
  const left = start[0].x;
  const right = start[1].x;
  const top = start[0].y;
  const bottom = start[2].y;

  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;

  if (drag === 0 || drag === 3) nextLeft = left + dx;
  if (drag === 1 || drag === 2) nextRight = right + dx;
  if (drag === 0 || drag === 1) nextTop = top + dy;
  if (drag === 2 || drag === 3) nextBottom = bottom + dy;

  // Keep the rectangle axis-aligned and enforce a usable minimum size.
  if (nextRight - nextLeft < MIN_RECT_SIZE) {
    if (drag === 0 || drag === 3) nextLeft = nextRight - MIN_RECT_SIZE;
    else nextRight = nextLeft + MIN_RECT_SIZE;
  }
  if (nextBottom - nextTop < MIN_RECT_SIZE) {
    if (drag === 0 || drag === 1) nextTop = nextBottom - MIN_RECT_SIZE;
    else nextBottom = nextTop + MIN_RECT_SIZE;
  }

  nextLeft = Math.max(CORNER_PADDING, nextLeft);
  nextRight = Math.min(canvas.width - CORNER_PADDING, nextRight);
  nextTop = Math.max(CORNER_PADDING, nextTop);
  nextBottom = Math.min(canvas.height - CORNER_PADDING, nextBottom);

  // A boundary correction can otherwise shrink the opposite side. Rebuild
  // the rectangle from the constrained edges to guarantee rectangularity.
  if (nextRight - nextLeft < MIN_RECT_SIZE) {
    if (drag === 0 || drag === 3) nextLeft = nextRight - MIN_RECT_SIZE;
    else nextRight = nextLeft + MIN_RECT_SIZE;
  }
  if (nextBottom - nextTop < MIN_RECT_SIZE) {
    if (drag === 0 || drag === 1) nextTop = nextBottom - MIN_RECT_SIZE;
    else nextBottom = nextTop + MIN_RECT_SIZE;
  }

  nextLeft = Math.max(CORNER_PADDING, nextLeft);
  nextRight = Math.min(canvas.width - CORNER_PADDING, nextRight);
  nextTop = Math.max(CORNER_PADDING, nextTop);
  nextBottom = Math.min(canvas.height - CORNER_PADDING, nextBottom);

  points = [
    { x: nextLeft, y: nextTop },
    { x: nextRight, y: nextTop },
    { x: nextRight, y: nextBottom },
    { x: nextLeft, y: nextBottom }
  ];
}

canvas.onpointerdown = event => {
  if (!calibrating) return;
  const point = pointerPosition(event);
  drag = points.findIndex(corner => Math.hypot(corner.x - point.x, corner.y - point.y) < 40);
  if (drag >= 0) {
    dragStart = {
      pointer: point,
      points: points.map(({ x, y }) => ({ x, y }))
    };
    canvas.setPointerCapture(event.pointerId);
  }
};

canvas.onpointermove = event => {
  if (drag >= 0 && dragStart) applyCornerDrag(pointerPosition(event));
};

canvas.onpointerup = () => {
  drag = -1;
  dragStart = null;
};

canvas.onpointercancel = () => {
  drag = -1;
  dragStart = null;
};

function drawVideoCover() {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return;

  // Match the <video>'s object-fit: cover geometry exactly. The pixels
  // analysed by getImageData must occupy the same screen coordinates as the
  // calibration rectangle and the visible camera image.
  const scale = Math.max(canvas.width / videoWidth, canvas.height / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;

  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

function loop(timestamp) {
  requestAnimationFrame(loop);
  if (video.readyState < 2 || !points) return;

  drawVideoCover();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const dot = detect(image, canvas.width, canvas.height, points, previousDetection);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = calibrating ? '#69f5dc' : '#69f5dc88';
  context.lineWidth = 3;
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
  context.stroke();

  points.forEach((point, index) => {
    context.fillStyle = calibrating ? '#ffd34e' : '#69f5dc';
    context.beginPath();
    context.arc(point.x, point.y, calibrating ? 11 : 5, 0, Math.PI * 2);
    context.fill();
    if (calibrating) {
      context.fillStyle = '#fff';
      context.fillText(['TL', 'TR', 'BR', 'BL'][index], point.x + 14, point.y);
    }
  });

  if (DEBUG && dot?.candidates) {
    dot.candidates.forEach((candidate, index) => {
      if (candidate === dot) return;
      context.strokeStyle = index < 5 ? '#ffd34eaa' : '#ffffff44';
      context.lineWidth = 2;
      context.strokeRect(
        candidate.x - candidate.width / 2,
        candidate.y - candidate.height / 2,
        candidate.width,
        candidate.height
      );
    });
  }

  if (dot?.reliable && dot.confidence >= TRACKING.MIN_CONFIDENCE) {
    previousDetection = { x: dot.x, y: dot.y };
    missedFrames = 0;
    context.fillStyle = '#ff315c';
    context.beginPath();
    context.arc(dot.x, dot.y, 10, 0, Math.PI * 2);
    context.fill();
    $('#tracking').textContent = `Tracking: ${Math.round(dot.confidence * 100)}% · ${dot.candidates.length} candidate${dot.candidates.length === 1 ? '' : 's'}`;

    if (timestamp - lastTransmission > 25) {
      const position = normalize(dot, points);
      ws?.send(JSON.stringify({
        type: 'laser',
        detected: true,
        x: position.x,
        y: position.y,
        timestamp: Date.now()
      }));
      lastTransmission = timestamp;
    }
  } else if (previousDetection && missedFrames < TRACKING.TRACKING_GRACE_FRAMES) {
    missedFrames++;
    const retained = normalize(previousDetection, points);
    $('#tracking').textContent = `Tracking: GRACE (${missedFrames}/${TRACKING.TRACKING_GRACE_FRAMES})`;
    context.fillStyle = '#ffd34e';
    context.beginPath();
    context.arc(previousDetection.x, previousDetection.y, 8, 0, Math.PI * 2);
    context.fill();

    if (timestamp - lastTransmission > 50) {
      ws?.send(JSON.stringify({
        type: 'laser',
        detected: true,
        x: retained.x,
        y: retained.y,
        timestamp: Date.now()
      }));
      lastTransmission = timestamp;
    }
  } else {
    previousDetection = null;
    missedFrames = TRACKING.TRACKING_GRACE_FRAMES;
    $('#tracking').textContent = 'Tracking: —';

    if (timestamp - lastTransmission > 100) {
      ws?.send(JSON.stringify({
        type: 'laser',
        detected: false,
        timestamp: Date.now()
      }));
      lastTransmission = timestamp;
    }
  }
}
