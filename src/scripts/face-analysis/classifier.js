/**
 * Face Shape Classifier — 7-shape Gaussian multi-ratio classifier.
 * Port 1:1 from Visevo Flutter app (lib/features/scan/analysis/face_shape_classifier.dart).
 */

import { dist2d } from './landmarks.js';

function gaussianScore(value, ideal, sigma) {
  const diff = value - ideal;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

// Shape profiles — each shape has 4 criteria with (ratio, ideal, sigma, weight)
const SHAPE_PROFILES = {
  oval: [
    { ratio: 'lengthWidth', ideal: 1.50, sigma: 0.15, weight: 0.30 },
    { ratio: 'jawForehead', ideal: 0.75, sigma: 0.10, weight: 0.25 },
    { ratio: 'cheekJaw', ideal: 1.15, sigma: 0.10, weight: 0.25 },
    { ratio: 'chin', ideal: 0.30, sigma: 0.08, weight: 0.20 },
  ],
  round: [
    { ratio: 'lengthWidth', ideal: 1.05, sigma: 0.10, weight: 0.30 },
    { ratio: 'jawForehead', ideal: 0.90, sigma: 0.10, weight: 0.25 },
    { ratio: 'cheekJaw', ideal: 1.05, sigma: 0.08, weight: 0.25 },
    { ratio: 'jawAngle', ideal: 2.40, sigma: 0.25, weight: 0.20 },
  ],
  square: [
    { ratio: 'lengthWidth', ideal: 1.10, sigma: 0.10, weight: 0.25 },
    { ratio: 'jawForehead', ideal: 0.95, sigma: 0.08, weight: 0.25 },
    { ratio: 'jawAngle', ideal: 1.57, sigma: 0.20, weight: 0.25 },
    { ratio: 'cheekJaw', ideal: 1.02, sigma: 0.06, weight: 0.25 },
  ],
  heart: [
    { ratio: 'lengthWidth', ideal: 1.35, sigma: 0.15, weight: 0.20 },
    { ratio: 'jawForehead', ideal: 0.60, sigma: 0.10, weight: 0.30 },
    { ratio: 'chin', ideal: 0.25, sigma: 0.06, weight: 0.25 },
    { ratio: 'cheekForehead', ideal: 0.95, sigma: 0.10, weight: 0.25 },
  ],
  oblong: [
    { ratio: 'lengthWidth', ideal: 1.70, sigma: 0.15, weight: 0.35 },
    { ratio: 'jawForehead', ideal: 0.85, sigma: 0.10, weight: 0.25 },
    { ratio: 'cheekJaw', ideal: 1.10, sigma: 0.10, weight: 0.20 },
    { ratio: 'chin', ideal: 0.28, sigma: 0.08, weight: 0.20 },
  ],
  diamond: [
    { ratio: 'lengthWidth', ideal: 1.40, sigma: 0.15, weight: 0.20 },
    { ratio: 'cheekForehead', ideal: 1.15, sigma: 0.10, weight: 0.30 },
    { ratio: 'cheekJaw', ideal: 1.30, sigma: 0.10, weight: 0.30 },
    { ratio: 'lowerJawForehead', ideal: 0.70, sigma: 0.10, weight: 0.20 },
  ],
  triangle: [
    { ratio: 'lengthWidth', ideal: 1.20, sigma: 0.15, weight: 0.20 },
    { ratio: 'jawForehead', ideal: 1.10, sigma: 0.10, weight: 0.30 },
    { ratio: 'cheekJaw', ideal: 0.95, sigma: 0.08, weight: 0.25 },
    { ratio: 'lowerJawForehead', ideal: 1.05, sigma: 0.10, weight: 0.25 },
  ],
};

function computeJawAngles(lm) {
  // Jaw angle: angle at jaw point between temple and chin
  const leftAngle = angleBetweenPoints(lm.templeLeft, lm.jawLeft, lm.chinBottom);
  const rightAngle = angleBetweenPoints(lm.templeRight, lm.jawRight, lm.chinBottom);
  return (leftAngle + rightAngle) / 2;
}

function angleBetweenPoints(a, b, c) {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const magBA = Math.sqrt(bax * bax + bay * bay);
  const magBC = Math.sqrt(bcx * bcx + bcy * bcy);
  if (magBA < 1e-7 || magBC < 1e-7) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}

function computeRatios(lm) {
  const EPSILON = 1e-7;
  return {
    lengthWidth: lm.faceHeight / Math.max(lm.faceWidth, EPSILON),
    jawForehead: lm.jawWidth / Math.max(lm.foreheadWidth, EPSILON),
    cheekJaw: lm.cheekboneWidth / Math.max(lm.jawWidth, EPSILON),
    jawAngle: computeJawAngles(lm),
    chin: lm.chinLength / Math.max(lm.faceHeight, EPSILON),
    cheekForehead: lm.cheekboneWidth / Math.max(lm.foreheadWidth, EPSILON),
    lowerJawForehead: lm.lowerJawWidth / Math.max(lm.foreheadWidth, EPSILON),
  };
}

/**
 * Classify face shape from parsed landmarks.
 * @param {object} lm — parsed landmarks from parseLandmarks()
 * @returns {{ shape: string, confidence: number }}
 */
export function classifyFaceShape(lm) {
  const ratios = computeRatios(lm);

  let bestShape = 'oval';
  let bestScore = -1;

  for (const [shape, criteria] of Object.entries(SHAPE_PROFILES)) {
    let totalScore = 0;
    for (const c of criteria) {
      const value = ratios[c.ratio];
      totalScore += c.weight * gaussianScore(value, c.ideal, c.sigma);
    }
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestShape = shape;
    }
  }

  return { shape: bestShape, confidence: bestScore };
}

// Shape descriptions for display
export const SHAPE_DESCRIPTIONS = {
  oval: 'Balanced proportions with gently curved jawline — the most versatile face shape.',
  round: 'Soft, full features with similar width and length — naturally youthful appearance.',
  square: 'Strong, defined jawline with angular features — bold and structured.',
  heart: 'Wider forehead tapering to a delicate chin — elegant and distinctive.',
  oblong: 'Elongated proportions with balanced width — refined and statuesque.',
  diamond: 'Prominent cheekbones with narrow forehead and jaw — striking and unique.',
  triangle: 'Strong jaw wider than forehead — powerful and grounded.',
};
