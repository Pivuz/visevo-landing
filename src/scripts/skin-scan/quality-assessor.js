/**
 * Photo Quality Assessment (PQA) — evaluates per-metric measurement reliability.
 *
 * Computes quality signals from landmarks + image metadata, then derives
 * a confidence score (0-1) for each scoring metric. This tells the system
 * how much to trust each measurement given the photo conditions.
 *
 * Quality signals (computed without additional models):
 * - Frontality: how frontal the face is (roll, yaw, pitch)
 * - Face Resolution: how many pixels cover the face
 * - Perspective Distortion: wide-angle lens distortion estimate
 * - Expression Neutrality: how neutral the expression is
 */

import { SYMMETRY_PAIRS, dist2d } from './landmarks.js';

const EPSILON = 1e-7;

// --- Quality Signal Thresholds ---

// Frontality: angles beyond these are considered poor
const MAX_ROLL = 0.40;   // ~23 degrees
const MAX_YAW = 0.20;    // ratio threshold
const MAX_PITCH = 0.20;  // ratio threshold

// Face resolution: minimum and ideal face pixel dimensions
const MIN_FACE_PX = 80;   // below this, landmarks are very unreliable
const GOOD_FACE_PX = 200; // above this, landmarks are reliable
const IDEAL_FACE_PX = 350; // above this, maximum confidence

// Perspective distortion: normal face H/W range
const NORMAL_HW_LOW = 1.05;
const NORMAL_HW_HIGH = 1.55;
const NORMAL_NOSE_FACE_MAX = 0.30; // noseW/faceW above this suggests wide-angle

// Expression blendshape indices
const MOUTH_SMILE_LEFT = 44;
const MOUTH_SMILE_RIGHT = 45;
const EYE_BLINK_LEFT = 9;
const EYE_BLINK_RIGHT = 10;
const MOUTH_OPEN = 25; // jawOpen
const BROW_UP_LEFT = 3;
const BROW_UP_RIGHT = 4;

// --- Confidence thresholds for output ---
export const CONFIDENCE_HIGH = 0.70;
export const CONFIDENCE_MEDIUM = 0.40;

// --- Per-metric confidence weights ---
// Each metric depends on different quality signals with different importance

const METRIC_WEIGHTS = {
  symmetry:    { frontality: 0.60, faceResolution: 0.25, perspectiveDistortion: 0.05, expressionNeutrality: 0.10 },
  goldenRatio: { frontality: 0.20, faceResolution: 0.35, perspectiveDistortion: 0.35, expressionNeutrality: 0.10 },
  thirds:      { frontality: 0.25, faceResolution: 0.25, perspectiveDistortion: 0.30, expressionNeutrality: 0.20 },
  fifths:      { frontality: 0.65, faceResolution: 0.25, perspectiveDistortion: 0.05, expressionNeutrality: 0.05 },
  jawline:     { frontality: 0.30, faceResolution: 0.35, perspectiveDistortion: 0.25, expressionNeutrality: 0.10 },
  averageness: { frontality: 0.20, faceResolution: 0.35, perspectiveDistortion: 0.35, expressionNeutrality: 0.10 },
  harmony:     { frontality: 0.30, faceResolution: 0.30, perspectiveDistortion: 0.25, expressionNeutrality: 0.15 },
};

// Weights for combining per-metric confidence into overall confidence
// (mirrors scoring weights from calculators.js)
const OVERALL_WEIGHTS = {
  symmetry: 0.05,
  goldenRatio: 0.25,
  thirds: 0.25,
  averageness: 0.20,
  harmony: 0.12,
  jawline: 0.10,
  fifths: 0.03,
};

// --- Signal computation ---

/**
 * Compute frontality score from landmark positions.
 * Uses the same logic as validators.js but returns continuous 0-1 instead of pass/fail.
 * @param {object} lm — parsed landmarks
 * @returns {number} 0-1 (1 = perfectly frontal)
 */
function computeFrontality(lm) {
  // Roll: eye line angle
  const rollAngle = Math.atan2(
    lm.rightEyeOuter.y - lm.leftEyeOuter.y,
    lm.rightEyeOuter.x - lm.leftEyeOuter.x,
  );
  const rollScore = 1.0 - Math.min(Math.abs(rollAngle) / MAX_ROLL, 1.0);

  // Yaw: Z asymmetry between eyes
  let yawScore = 1.0;
  const zDiff = (lm.leftEyeOuter.z || 0) - (lm.rightEyeOuter.z || 0);
  if (lm.faceWidth > EPSILON) {
    const yawRatio = Math.abs(zDiff / lm.faceWidth);
    yawScore = 1.0 - Math.min(yawRatio / MAX_YAW, 1.0);
  }

  // Pitch: Z depth between nose tip and bridge
  let pitchScore = 1.0;
  const pitchDiff = (lm.noseTip.z || 0) - (lm.noseBridgeTop.z || 0);
  if (lm.faceHeight > EPSILON) {
    const pitchRatio = Math.abs(pitchDiff / lm.faceHeight);
    pitchScore = 1.0 - Math.min(pitchRatio / MAX_PITCH, 1.0);
  }

  // Bilateral landmark asymmetry as additional frontality check (2D only, no Z dependency)
  let bilateralScore = 1.0;
  if (lm.faceWidth > EPSILON) {
    let totalAsym = 0;
    let count = 0;
    for (const [leftIdx, rightIdx] of SYMMETRY_PAIRS) {
      const leftDist = Math.abs(lm.points[leftIdx].x - lm.midlineX);
      const rightDist = Math.abs(lm.points[rightIdx].x - lm.midlineX);
      const asym = Math.abs(leftDist - rightDist) / lm.faceWidth;
      totalAsym += asym;
      count++;
    }
    const meanAsym = totalAsym / count;
    // meanAsym > 0.05 suggests significant non-frontality
    bilateralScore = 1.0 - Math.min(meanAsym / 0.08, 1.0);
  }

  // Weighted combination — roll most reliable (2D), yaw/pitch use Z (less reliable)
  return rollScore * 0.30 + yawScore * 0.25 + pitchScore * 0.20 + bilateralScore * 0.25;
}

/**
 * Compute face resolution score from face dimensions and image size.
 * @param {object} lm — parsed landmarks (normalized coords)
 * @param {number} imageWidth — image width in pixels
 * @param {number} imageHeight — image height in pixels
 * @returns {number} 0-1 (1 = high resolution face)
 */
function computeFaceResolution(lm, imageWidth, imageHeight) {
  const facePixelW = lm.faceWidth * imageWidth;
  const facePixelH = lm.faceHeight * imageHeight;
  const facePx = Math.min(facePixelW, facePixelH); // use shorter dimension

  if (facePx < MIN_FACE_PX) return 0.0;
  if (facePx >= IDEAL_FACE_PX) return 1.0;

  // Smooth ramp from MIN to IDEAL
  const t = (facePx - MIN_FACE_PX) / (IDEAL_FACE_PX - MIN_FACE_PX);
  // Ease-in curve: accelerating improvement
  return t * t;
}

/**
 * Estimate perspective distortion from facial geometry.
 * Wide-angle lenses make the nose appear larger and face wider/shorter.
 * @param {object} lm — parsed landmarks
 * @returns {number} 0-1 (1 = no distortion detected)
 */
function computePerspectiveDistortion(lm) {
  if (lm.faceWidth < EPSILON || lm.faceHeight < EPSILON) return 0.5;

  // Check 1: face H/W ratio — distorted faces appear wider (lower ratio)
  const hwRatio = lm.faceHeight / lm.faceWidth;
  let hwScore = 1.0;
  if (hwRatio < NORMAL_HW_LOW) {
    hwScore = Math.max(0, 1.0 - (NORMAL_HW_LOW - hwRatio) / 0.3);
  } else if (hwRatio > NORMAL_HW_HIGH) {
    hwScore = Math.max(0, 1.0 - (hwRatio - NORMAL_HW_HIGH) / 0.3);
  }

  // Check 2: nose-to-face width ratio — wide-angle inflates nose
  const noseFaceRatio = lm.noseWidth / lm.faceWidth;
  let noseScore = 1.0;
  if (noseFaceRatio > NORMAL_NOSE_FACE_MAX) {
    noseScore = Math.max(0, 1.0 - (noseFaceRatio - NORMAL_NOSE_FACE_MAX) / 0.15);
  }

  // Check 3: forehead-to-jaw width ratio — perspective makes one end appear larger
  let perspScore = 1.0;
  if (lm.foreheadWidth > EPSILON && lm.jawWidth > EPSILON) {
    const fwRatio = lm.foreheadWidth / lm.jawWidth;
    // Normal range: 1.0-1.5. Very close selfies can push this outside range.
    if (fwRatio < 0.85 || fwRatio > 1.8) {
      perspScore = 0.5;
    }
  }

  return hwScore * 0.40 + noseScore * 0.35 + perspScore * 0.25;
}

/**
 * Compute expression neutrality from blendshapes.
 * @param {number[]|null} blendshapes — 52-element blendshape array
 * @returns {number} 0-1 (1 = perfectly neutral)
 */
function computeExpressionNeutrality(blendshapes) {
  if (!blendshapes || blendshapes.length < 52) return 0.7; // assume decent if unavailable

  const smileLeft = blendshapes[MOUTH_SMILE_LEFT] || 0;
  const smileRight = blendshapes[MOUTH_SMILE_RIGHT] || 0;
  const blinkLeft = blendshapes[EYE_BLINK_LEFT] || 0;
  const blinkRight = blendshapes[EYE_BLINK_RIGHT] || 0;
  const jawOpen = blendshapes[MOUTH_OPEN] || 0;
  const browUpLeft = blendshapes[BROW_UP_LEFT] || 0;
  const browUpRight = blendshapes[BROW_UP_RIGHT] || 0;

  // Each expression type reduces neutrality
  const smileImpact = Math.max(smileLeft, smileRight); // 0-1
  const blinkImpact = Math.max(blinkLeft, blinkRight);
  const mouthImpact = jawOpen;
  const browImpact = Math.max(browUpLeft, browUpRight) * 0.5; // brows less impactful

  const maxImpact = Math.max(smileImpact, blinkImpact, mouthImpact, browImpact);
  return Math.max(0, 1.0 - maxImpact);
}

// --- Confidence computation ---

/**
 * Compute weighted confidence for a single metric.
 * @param {object} signals — quality signals { frontality, faceResolution, perspectiveDistortion, expressionNeutrality }
 * @param {object} weights — per-signal weights for this metric
 * @returns {number} 0-1
 */
function weightedConfidence(signals, weights) {
  let conf = 0;
  for (const [signal, weight] of Object.entries(weights)) {
    conf += (signals[signal] ?? 0.5) * weight;
  }
  return Math.max(0, Math.min(1, conf));
}

// --- Main assessment function ---

/**
 * Assess photo quality for facial analysis.
 *
 * @param {object} lm — parsed landmarks from parseLandmarks()
 * @param {number} imageWidth — image width in pixels
 * @param {number} imageHeight — image height in pixels
 * @param {number[]|null} blendshapes — 52-element blendshape array (optional)
 * @returns {object} Quality assessment with signals, per-metric confidence, and overall confidence
 */
export function assessPhotoQuality(lm, imageWidth, imageHeight, blendshapes) {
  const signals = {
    frontality: computeFrontality(lm),
    faceResolution: computeFaceResolution(lm, imageWidth, imageHeight),
    perspectiveDistortion: computePerspectiveDistortion(lm),
    expressionNeutrality: computeExpressionNeutrality(blendshapes),
  };

  // Per-metric confidence
  const metricConfidence = {};
  for (const [metric, weights] of Object.entries(METRIC_WEIGHTS)) {
    metricConfidence[metric] = weightedConfidence(signals, weights);
  }

  // Harmony confidence = minimum of the 5 base metric confidences
  metricConfidence.harmony = Math.min(
    metricConfidence.symmetry,
    metricConfidence.goldenRatio,
    metricConfidence.thirds,
    metricConfidence.fifths,
    metricConfidence.jawline,
  );

  // Overall confidence = weighted average using scoring weights
  let overallConfidence = 0;
  for (const [metric, weight] of Object.entries(OVERALL_WEIGHTS)) {
    overallConfidence += (metricConfidence[metric] ?? 0.5) * weight;
  }

  return {
    signals,
    metricConfidence,
    overallConfidence,
  };
}

/**
 * Compute score range based on confidence.
 * High confidence → tight range; low confidence → wide range.
 *
 * @param {number} score — the computed score (0-100)
 * @param {number} confidence — metric confidence (0-1)
 * @returns {{ min: number, max: number, precise: boolean }}
 */
export function computeMetricRange(score, confidence) {
  if (confidence >= CONFIDENCE_HIGH) {
    return { min: score, max: score, precise: true };
  }

  // Margin increases as confidence decreases
  // At confidence 0.4 → margin ~12; at confidence 0.0 → margin ~20
  const maxMargin = 20;
  const margin = Math.round(maxMargin * (1.0 - confidence));
  return {
    min: Math.max(0, Math.round(score - margin / 2)),
    max: Math.min(100, Math.round(score + margin / 2)),
    precise: false,
  };
}

/**
 * Generate user-facing warnings and suggestions based on quality assessment.
 *
 * @param {object} quality — result from assessPhotoQuality()
 * @returns {{ warnings: string[], suggestions: string[] }}
 */
export function generateQualityFeedback(quality) {
  const warnings = [];
  const suggestions = [];
  const s = quality.signals;

  // Frontality issues
  if (s.frontality < 0.5) {
    warnings.push('Head position may affect accuracy');
    suggestions.push('Face the camera directly for more precise results');
  } else if (s.frontality < CONFIDENCE_HIGH) {
    suggestions.push('Try facing the camera more directly');
  }

  // Resolution issues
  if (s.faceResolution < 0.3) {
    warnings.push('Face is too small in the image');
    suggestions.push('Move closer to the camera or crop the photo to your face');
  } else if (s.faceResolution < 0.6) {
    suggestions.push('A closer photo would improve accuracy');
  }

  // Perspective distortion
  if (s.perspectiveDistortion < 0.5) {
    warnings.push('Wide-angle distortion detected');
    suggestions.push('Hold the camera at arm\'s length or use the rear camera for less distortion');
  } else if (s.perspectiveDistortion < CONFIDENCE_HIGH) {
    suggestions.push('Slightly more distance from the camera may improve proportional accuracy');
  }

  // Expression
  if (s.expressionNeutrality < 0.4) {
    warnings.push('Facial expression may affect measurements');
    suggestions.push('Try a neutral, relaxed expression');
  }

  return { warnings, suggestions };
}

/**
 * Determine the overall precision level for UI display.
 *
 * @param {number} overallConfidence — from assessPhotoQuality()
 * @returns {'high'|'good'|'approximate'}
 */
export function getPrecisionLevel(overallConfidence) {
  if (overallConfidence >= CONFIDENCE_HIGH) return 'high';
  if (overallConfidence >= CONFIDENCE_MEDIUM) return 'good';
  return 'approximate';
}
