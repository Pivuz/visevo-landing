/**
 * Heatmap Renderer — draws colored zone overlays on a canvas over the face photo.
 */

import { ZONES } from './skin-analyzer.js';

/**
 * Map a score (0-100) to a semi-transparent color.
 */
function scoreToColor(score) {
  if (score >= 70) return 'rgba(94, 234, 212, 0.3)';   // teal — good
  if (score >= 50) return 'rgba(125, 211, 252, 0.3)';   // light blue — decent
  if (score >= 35) return 'rgba(252, 211, 77, 0.3)';    // yellow — mediocre
  return 'rgba(251, 113, 133, 0.3)';                     // rose — needs work
}

/**
 * Draw a single zone's heatmap overlay.
 */
function drawZone(ctx, landmarks, indices, color, canvasWidth, canvasHeight) {
  ctx.fillStyle = color;
  ctx.filter = 'blur(8px)';

  for (const idx of indices) {
    if (idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    const x = lm.x * canvasWidth;
    const y = lm.y * canvasHeight;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.filter = 'none';
}

/**
 * Render heatmap overlay on a canvas.
 * @param {HTMLCanvasElement} overlayCanvas — canvas sized to match the photo
 * @param {Array} landmarks — 478 normalized landmarks from MediaPipe
 * @param {object} zoneScores — { forehead, leftCheek, rightCheek, chin, nose }
 * @param {number} animationStep — 0-5, controls which zones are visible
 */
export function renderHeatmap(overlayCanvas, landmarks, zoneScores, animationStep) {
  const ctx = overlayCanvas.getContext('2d');
  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  ctx.clearRect(0, 0, w, h);

  const zoneOrder = ['forehead', 'leftCheek', 'rightCheek', 'nose', 'chin'];

  for (let i = 0; i < Math.min(animationStep, zoneOrder.length); i++) {
    const zoneName = zoneOrder[i];
    const score = zoneScores[zoneName] ?? 50;
    const color = scoreToColor(score);
    drawZone(ctx, landmarks, ZONES[zoneName], color, w, h);
  }
}

export { scoreToColor };
