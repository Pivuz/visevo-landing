/**
 * Score calculators — port 1:1 from Visevo Flutter app.
 * Each calculator takes parsed landmarks and returns a score 0-100.
 */

import { SYMMETRY_PAIRS, dist2d } from './landmarks.js';

const EPSILON = 1e-7;
const PHI = 1.618034;

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// --- Symmetry Calculator ---

export function calculateSymmetry(lm) {
  const midX = lm.midlineX;
  let totalAsymmetry = 0;

  for (const [leftIdx, rightIdx] of SYMMETRY_PAIRS) {
    const leftDist = Math.abs(lm.points[leftIdx].x - midX);
    const rightDist = Math.abs(lm.points[rightIdx].x - midX);
    const maxDist = Math.max(leftDist, rightDist, EPSILON);
    totalAsymmetry += Math.abs(leftDist - rightDist) / maxDist;
  }

  const meanAsymmetry = totalAsymmetry / SYMMETRY_PAIRS.length;
  return clamp((1 - meanAsymmetry) * 100);
}

// --- Golden Ratio Calculator ---

export function calculateGoldenRatio(lm) {
  const browMidX = lm.midlineX;
  const browMidY = lm.browMidpointY;
  const dx = browMidX - lm.noseTip.x;
  const dy = browMidY - lm.noseTip.y;
  const browToNose = Math.sqrt(dx * dx + dy * dy);

  const noseToLip = dist2d(lm.noseTip, lm.upperLipTop);
  const lipToChin = dist2d(lm.upperLipTop, lm.chinBottom);
  const noseToChin = dist2d(lm.noseTip, lm.chinBottom);

  const ratios = [
    lm.faceHeight / Math.max(lm.faceWidth, EPSILON),
    lm.faceWidth / Math.max(lm.interocularDistance, EPSILON),
    lm.noseWidth / Math.max(lm.lipWidth, EPSILON),
    noseToLip / Math.max(lipToChin, EPSILON),
    browToNose / Math.max(noseToChin, EPSILON),
  ];

  let totalScore = 0;
  for (const r of ratios) {
    const deviation = Math.abs(r - PHI) / PHI;
    totalScore += Math.exp(-1.5 * deviation * deviation);
  }

  return clamp((totalScore / ratios.length) * 100);
}

// --- Jawline Calculator ---

function angleBetween(a, b, c) {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const magBA = Math.sqrt(bax * bax + bay * bay);
  const magBC = Math.sqrt(bcx * bcx + bcy * bcy);
  if (magBA < EPSILON || magBC < EPSILON) return Math.PI;
  return Math.acos(clamp(dot / (magBA * magBC), -1, 1));
}

function contourSymmetry(contour) {
  const midIdx = Math.floor(contour.length / 2);
  const midPoint = contour[midIdx];

  const leftDistances = [];
  for (let i = 0; i < midIdx; i++) {
    leftDistances.push(dist2d(contour[i], midPoint));
  }

  const rightDistances = [];
  for (let i = midIdx + 1; i < contour.length; i++) {
    rightDistances.push(dist2d(contour[i], midPoint));
  }

  const pairCount = Math.min(leftDistances.length, rightDistances.length);
  if (pairCount === 0) return 1.0;

  let totalDiff = 0;
  let totalAvg = 0;
  for (let i = 0; i < pairCount; i++) {
    const left = leftDistances[i];
    const right = rightDistances[rightDistances.length - 1 - i];
    totalDiff += Math.abs(left - right);
    totalAvg += (left + right) / 2;
  }

  if (totalAvg < EPSILON) return 1.0;
  const relDiff = totalDiff / totalAvg;
  return Math.exp(-3.0 * relDiff * relDiff);
}

export function calculateJawline(lm) {
  const contour = lm.jawContour;
  if (contour.length < 5) return 50;

  const midIdx = Math.floor(contour.length / 2);
  const jawAngle = angleBetween(contour[0], contour[midIdx], contour[contour.length - 1]);

  const IDEAL_ANGLE = (120 * Math.PI) / 180;
  const MAX_DEVIATION = (45 * Math.PI) / 180;
  const deviation = Math.abs(jawAngle - IDEAL_ANGLE);
  const angleScore = Math.exp(-2.0 * Math.pow(deviation / MAX_DEVIATION, 2));

  const smoothnessScore = contourSymmetry(contour);

  return clamp((angleScore * 0.6 + smoothnessScore * 0.4) * 100);
}

// --- Facial Thirds Calculator ---

export function calculateFacialThirds(lm) {
  const top = lm.foreheadTop.y;
  const brows = lm.browMidpointY;
  const noseBase = lm.noseTip.y;
  const chin = lm.chinBottom.y;

  const upper = Math.abs(brows - top);
  const middle = Math.abs(noseBase - brows);
  const lower = Math.abs(chin - noseBase);
  const total = upper + middle + lower;

  if (total < EPSILON) return 0;

  const idealThird = total / 3;
  const upperDev = Math.abs(upper - idealThird) / idealThird;
  const middleDev = Math.abs(middle - idealThird) / idealThird;
  const lowerDev = Math.abs(lower - idealThird) / idealThird;

  const meanDev = (upperDev + middleDev + lowerDev) / 3;
  return clamp((1 - meanDev) * 100);
}

// --- Facial Fifths Calculator ---

export function calculateFacialFifths(lm) {
  const x0 = lm.faceLeftEdge.x;
  const x1 = lm.leftEyeOuter.x;
  const x2 = lm.leftEyeInner.x;
  const x3 = lm.rightEyeInner.x;
  const x4 = lm.rightEyeOuter.x;
  const x5 = lm.faceRightEdge.x;

  const fifths = [
    Math.abs(x1 - x0),
    Math.abs(x2 - x1),
    Math.abs(x3 - x2),
    Math.abs(x4 - x3),
    Math.abs(x5 - x4),
  ];
  const total = fifths.reduce((s, v) => s + v, 0);

  if (total < EPSILON) return 0;

  const idealFifth = total / 5;
  let totalDev = 0;
  for (const f of fifths) {
    totalDev += Math.abs(f - idealFifth) / idealFifth;
  }

  const meanDev = totalDev / 5;
  return clamp((1 - meanDev) * 100);
}

// --- Structure Score (Glow Score for web) ---

const WEIGHTS = {
  symmetry: 0.30,
  goldenRatio: 0.25,
  jawline: 0.20,
  facialThirds: 0.15,
  facialFifths: 0.10,
};

export function calculateStructureScore(lm) {
  const scores = {
    symmetry: calculateSymmetry(lm),
    goldenRatio: calculateGoldenRatio(lm),
    jawline: calculateJawline(lm),
    facialThirds: calculateFacialThirds(lm),
    facialFifths: calculateFacialFifths(lm),
  };

  const structureScore =
    scores.symmetry * WEIGHTS.symmetry +
    scores.goldenRatio * WEIGHTS.goldenRatio +
    scores.jawline * WEIGHTS.jawline +
    scores.facialThirds * WEIGHTS.facialThirds +
    scores.facialFifths * WEIGHTS.facialFifths;

  return {
    ...scores,
    structureScore: clamp(structureScore),
  };
}
