/**
 * Score calculators v2 — port 1:1 from Visevo Flutter app.
 * Percentile-based scoring with evidence-based ratios.
 *
 * Changes from v1:
 * - Symmetry: zone-weighted, X+Y, normalized by faceWidth
 * - Golden Ratio → Facial Proportions: empirical ratios (Pallett 2010)
 * - Facial Thirds: weighted zones, inter-third penalty
 * - Facial Fifths: weighted zones, bilateral asymmetry penalty
 * - Jawline: angle + width ratio + definition + symmetry
 * - All use percentile-based calibration (MetricCalibration)
 */

import { SYMMETRY_PAIRS, dist2d } from './landmarks.js';

const EPSILON = 1e-7;

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// --- MetricCalibration (percentile-based scoring) ---

function normalCdf(z) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1.0 : 1.0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function calibrateDeviation(deviation, { mean, stddev, gamma, floor, ceiling }) {
  if (stddev <= 0) return (floor + ceiling) / 2;
  const z = (mean - deviation) / stddev;
  const percentile = normalCdf(z);
  const stretched = Math.pow(percentile, gamma) * 100;
  return clamp(stretched, floor, ceiling);
}

function calibrate(raw, { mean, stddev, gamma, floor, ceiling }) {
  if (stddev <= 0) return (floor + ceiling) / 2;
  const z = (raw - mean) / stddev;
  const percentile = normalCdf(z);
  const stretched = Math.pow(percentile, gamma) * 100;
  return clamp(stretched, floor, ceiling);
}

// Calibration parameters (match Dart ScoreCalibration class exactly)
// Calibration parameters V3 — empirical from n=100 SCUT-FBP5500 (MediaPipe)
const CAL = {
  symmetry:          { mean: 0.043, stddev: 0.030, gamma: 0.65, floor: 10, ceiling: 98 },
  facialProportions: { mean: 0.072, stddev: 0.032, gamma: 0.65, floor: 12, ceiling: 98 },
  facialThirds:      { mean: 0.29,  stddev: 0.07,  gamma: 0.70, floor: 12, ceiling: 98 },
  facialFifths:      { mean: 0.20,  stddev: 0.10,  gamma: 0.70, floor: 12, ceiling: 98 },
  jawline:           { mean: 0.55,  stddev: 0.15,  gamma: 0.70, floor: 10, ceiling: 98 },
  averageness:       { mean: 0.088, stddev: 0.033, gamma: 0.70, floor: 12, ceiling: 98 },
  harmony:           { mean: 0.25,  stddev: 0.12,  gamma: 0.70, floor: 15, ceiling: 98 },
};

// --- Symmetry Calculator v2 ---

const ZONE_WEIGHTS = {
  '33,263': 1.5, '133,362': 1.5, '130,359': 1.2, '243,463': 1.2,
  '107,336': 1.3, '66,296': 1.0, '105,334': 0.8,
  '46,276': 0.8, '116,345': 0.8, '123,352': 0.8,
  '98,327': 1.2, '49,279': 1.0,
  '61,291': 1.4, '40,270': 1.2, '88,318': 1.0,
  '58,288': 0.7, '172,397': 0.6, '132,361': 0.7, '127,356': 0.5,
};

export function calculateSymmetry(lm) {
  const midX = lm.midlineX;
  const faceW = lm.faceWidth;
  if (faceW < EPSILON) return 50;

  let weightedAsymmetry = 0;
  let totalWeight = 0;

  for (const [leftIdx, rightIdx] of SYMMETRY_PAIRS) {
    const leftPt = lm.points[leftIdx];
    const rightPt = lm.points[rightIdx];

    const leftDistX = Math.abs(leftPt.x - midX);
    const rightDistX = Math.abs(rightPt.x - midX);
    const asymX = Math.abs(leftDistX - rightDistX) / faceW;
    const asymY = Math.abs(leftPt.y - rightPt.y) / faceW;
    const asym = asymX * 0.75 + asymY * 0.25;

    const key = `${leftIdx},${rightIdx}`;
    const w = ZONE_WEIGHTS[key] ?? 1.0;
    weightedAsymmetry += asym * w;
    totalWeight += w;
  }

  if (totalWeight < EPSILON) return 50;
  const meanAsymmetry = weightedAsymmetry / totalWeight;
  return calibrateDeviation(meanAsymmetry, CAL.symmetry);
}

// --- Golden Ratio Calculator v2 (Facial Proportions) ---

// V3: Empirical ideals from top-20% beauty faces (n=100, MediaPipe).
// Removed iod_width and mouthW_iod — systematic 2x measurement error in MediaPipe.
const IDEAL_RATIOS = [
  { ideal: 0.37, weight: 2.0 },  // eyeMouth_height
  { ideal: 1.21, weight: 1.5 },  // height_width
  { ideal: 0.62, weight: 1.0 },  // nose_lip
  { ideal: 0.95, weight: 1.0 },  // brow_nose_chin
  { ideal: 0.23, weight: 0.8 },  // noseW_faceW
];
const IDEAL_KEYS = ['eyeMouth_height', 'height_width', 'nose_lip', 'brow_nose_chin', 'noseW_faceW'];

export function calculateGoldenRatio(lm) {
  const faceH = lm.faceHeight;
  const faceW = lm.faceWidth;
  const iod = lm.interocularDistance;
  if (faceH < EPSILON || faceW < EPSILON || iod < EPSILON) return 50;

  const eyeMidY = (lm.leftEyeInner.y + lm.rightEyeInner.y) / 2;
  const mouthY = lm.upperLipTop.y;
  const eyeMouthVertical = Math.abs(mouthY - eyeMidY);

  const browMidX = lm.midlineX;
  const browMidY = lm.browMidpointY;
  const bdx = browMidX - lm.noseTip.x;
  const bdy = browMidY - lm.noseTip.y;
  const browToNose = Math.sqrt(bdx * bdx + bdy * bdy);
  const noseToChin = dist2d(lm.noseTip, lm.chinBottom);

  // V3: 5 ratios (removed iod_width and mouthW_iod)
  const ratios = [
    eyeMouthVertical / faceH,
    faceH / faceW,
    lm.noseWidth / Math.max(lm.lipWidth, EPSILON),
    browToNose / Math.max(noseToChin, EPSILON),
    lm.noseWidth / faceW,
  ];

  let totalDeviation = 0;
  let totalWeight = 0;
  for (let i = 0; i < ratios.length; i++) {
    const ideal = IDEAL_RATIOS[i].ideal;
    const w = IDEAL_RATIOS[i].weight;
    const dev = Math.abs(ratios[i] - ideal) / ideal;
    totalDeviation += dev * w;
    totalWeight += w;
  }

  const meanDev = totalDeviation / totalWeight;
  return calibrateDeviation(meanDev, CAL.facialProportions);
}

// --- Jawline Calculator v2 ---

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
  for (let i = 0; i < midIdx; i++) leftDistances.push(dist2d(contour[i], midPoint));

  const rightDistances = [];
  for (let i = midIdx + 1; i < contour.length; i++) rightDistances.push(dist2d(contour[i], midPoint));

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
  return clamp(1.0 - relDiff * 3.0, 0, 1);
}

export function calculateJawline(lm) {
  const contour = lm.jawContour;
  if (contour.length < 5) return 50;

  // 1. Angle score
  const IDEAL_ANGLE = (125 * Math.PI) / 180;
  const midIdx = Math.floor(contour.length / 2);
  const jawAngle = angleBetween(contour[0], contour[midIdx], contour[contour.length - 1]);
  const angleDev = Math.abs(jawAngle - IDEAL_ANGLE) / IDEAL_ANGLE;
  const angleQuality = clamp(1.0 - angleDev, 0, 1);

  // 2. Bilateral symmetry
  const symmetryQuality = contourSymmetry(contour);

  // 3. Width ratio: jawWidth / cheekboneWidth → ideal 0.82
  const jawW = lm.jawWidth;
  const cheekW = lm.cheekboneWidth;
  let widthQuality = 0.5;
  if (cheekW > EPSILON) {
    const ratio = jawW / cheekW;
    const ratioDev = Math.abs(ratio - 0.82) / 0.82;
    widthQuality = clamp(1.0 - ratioDev * 2.0, 0, 1);
  }

  // 4. Definition (chin proportion)
  const faceH = lm.faceHeight;
  let definitionQuality = 0.5;
  if (faceH > EPSILON) {
    const chinLen = lm.chinLength;
    const chinRatio = chinLen / faceH;
    const dev = Math.abs(chinRatio - 0.10) / 0.10;
    definitionQuality = clamp(1.0 - dev, 0, 1);
  }

  const combined = angleQuality * 0.35 + symmetryQuality * 0.20 +
    widthQuality * 0.25 + definitionQuality * 0.20;

  return calibrate(combined, CAL.jawline);
}

// --- Facial Thirds Calculator v2 ---

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

  // Weighted zones: lower > middle > upper
  const weightedDev = (upperDev * 0.8 + middleDev * 1.0 + lowerDev * 1.2) / 3.0;

  // Inter-third ratio penalty
  const lowerToMiddle = middle > EPSILON ? lower / middle : 1.0;
  const interPenalty = Math.abs(lowerToMiddle - 1.0) * 0.15;

  const totalDev = weightedDev + interPenalty;
  return calibrateDeviation(totalDev, CAL.facialThirds);
}

// --- Facial Fifths Calculator v2 ---

const FIFTH_WEIGHTS = [0.8, 1.0, 1.5, 1.0, 0.8];

export function calculateFacialFifths(lm) {
  const x0 = lm.faceLeftEdge.x;
  const x1 = lm.leftEyeOuter.x;
  const x2 = lm.leftEyeInner.x;
  const x3 = lm.rightEyeInner.x;
  const x4 = lm.rightEyeOuter.x;
  const x5 = lm.faceRightEdge.x;

  const fifths = [
    Math.abs(x1 - x0), Math.abs(x2 - x1), Math.abs(x3 - x2),
    Math.abs(x4 - x3), Math.abs(x5 - x4),
  ];
  const total = fifths.reduce((s, v) => s + v, 0);
  if (total < EPSILON) return 0;

  const idealFifth = total / 5;
  let weightedDev = 0;
  let totalWeight = 0;
  for (let i = 0; i < 5; i++) {
    weightedDev += Math.abs(fifths[i] - idealFifth) / idealFifth * FIFTH_WEIGHTS[i];
    totalWeight += FIFTH_WEIGHTS[i];
  }
  const meanDev = weightedDev / totalWeight;

  // Bilateral asymmetry penalty
  const bilateralAsym = Math.abs(fifths[0] - fifths[4]) / (idealFifth + EPSILON);
  const penalty = bilateralAsym * 0.10;

  const totalDev = meanDev + penalty;
  return calibrateDeviation(totalDev, CAL.facialFifths);
}

// --- Averageness Calculator V3 (empirical MediaPipe means, n=100) ---

const POPULATION_MEANS = [
  { mean: 0.359 },  // eyeMouth_height
  { mean: 1.189 },  // height_width
  { mean: 0.604 },  // nose_lip
  { mean: 0.881 },  // brow_nose_chin
  { mean: 0.250 },  // noseW_faceW
];
const POP_KEYS = ['eyeMouth_height', 'height_width', 'nose_lip', 'brow_nose_chin', 'noseW_faceW'];

export function calculateAverageness(lm) {
  const faceH = lm.faceHeight;
  const faceW = lm.faceWidth;
  const iod = lm.interocularDistance;
  if (faceH < EPSILON || faceW < EPSILON || iod < EPSILON) return 50;

  const eyeMidY = (lm.leftEyeInner.y + lm.rightEyeInner.y) / 2;
  const mouthY = lm.upperLipTop.y;
  const eyeMouthVertical = Math.abs(mouthY - eyeMidY);

  const browMidX = lm.midlineX;
  const browMidY = lm.browMidpointY;
  const bdx = browMidX - lm.noseTip.x;
  const bdy = browMidY - lm.noseTip.y;
  const browToNose = Math.sqrt(bdx * bdx + bdy * bdy);
  const noseToChin = dist2d(lm.noseTip, lm.chinBottom);

  // V3: 5 ratios (removed iod_width and mouthW_iod)
  const ratios = [
    eyeMouthVertical / faceH,
    faceH / faceW,
    lm.noseWidth / Math.max(lm.lipWidth, EPSILON),
    browToNose / Math.max(noseToChin, EPSILON),
    lm.noseWidth / faceW,
  ];

  let sumSqDev = 0;
  for (let i = 0; i < ratios.length; i++) {
    const target = POPULATION_MEANS[i].mean;
    const dev = (ratios[i] - target) / target;
    sumSqDev += dev * dev;
  }
  const euclideanDev = Math.sqrt(sumSqDev / ratios.length);

  return calibrateDeviation(euclideanDev, CAL.averageness);
}

// --- Harmony Calculator (CV of base sub-scores) ---

export function calculateHarmony(subScores) {
  if (subScores.length === 0) return 50;
  const mean = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  if (Math.abs(mean) < EPSILON) return 50;

  const variance = subScores.reduce((sum, s) => sum + (s - mean) * (s - mean), 0) / subScores.length;
  const cv = Math.sqrt(variance) / mean;

  return calibrateDeviation(cv, CAL.harmony);
}

// --- Structure Score v3 ---

// V3 weights — data-driven from n=100 SCUT-FBP5500 correlations
const WEIGHTS = {
  facialThirds: 0.25,   // r=+0.525***
  goldenRatio: 0.25,    // r=+0.464***
  averageness: 0.20,    // r=+0.415***
  harmony: 0.12,        // r=+0.374***
  jawline: 0.10,        // r=+0.188 ns
  symmetry: 0.05,       // r=+0.058 ns
  facialFifths: 0.03,   // r=-0.092 ns
};

// --- Debug: raw metric extraction (pre-calibration values) ---

export function extractRawMetrics(lm) {
  const faceH = lm.faceHeight;
  const faceW = lm.faceWidth;
  const iod = lm.interocularDistance;
  const midX = lm.midlineX;

  // Raw symmetry: mean weighted asymmetry
  let wAsym = 0, wTotal = 0;
  for (const [leftIdx, rightIdx] of SYMMETRY_PAIRS) {
    const lp = lm.points[leftIdx], rp = lm.points[rightIdx];
    const asymX = Math.abs(Math.abs(lp.x - midX) - Math.abs(rp.x - midX)) / faceW;
    const asymY = Math.abs(lp.y - rp.y) / faceW;
    const asym = asymX * 0.75 + asymY * 0.25;
    const key = `${leftIdx},${rightIdx}`;
    const w = ZONE_WEIGHTS[key] ?? 1.0;
    wAsym += asym * w;
    wTotal += w;
  }
  const rawSymmetry = wTotal > EPSILON ? wAsym / wTotal : 0;

  // Raw proportions: individual ratios and weighted mean dev
  const eyeMidY = (lm.leftEyeInner.y + lm.rightEyeInner.y) / 2;
  const mouthY = lm.upperLipTop.y;
  const eyeMouthVertical = Math.abs(mouthY - eyeMidY);
  const bdx = lm.midlineX - lm.noseTip.x;
  const bdy = lm.browMidpointY - lm.noseTip.y;
  const browToNose = Math.sqrt(bdx * bdx + bdy * bdy);
  const noseToChin = dist2d(lm.noseTip, lm.chinBottom);

  const ratios = {
    eyeMouth_height: eyeMouthVertical / faceH,
    iod_width: iod / faceW,
    height_width: faceH / faceW,
    nose_lip: lm.noseWidth / Math.max(lm.lipWidth, EPSILON),
    brow_nose_chin: browToNose / Math.max(noseToChin, EPSILON),
    noseW_faceW: lm.noseWidth / faceW,
    mouthW_iod: lm.lipWidth / iod,
  };

  // Debug: show all 7 ratios with their deviations from V3 ideals
  const allKeys = ['eyeMouth_height','iod_width','height_width','nose_lip','brow_nose_chin','noseW_faceW','mouthW_iod'];
  const ratioDevs = {};
  for (const key of allKeys) {
    const actual = ratios[key];
    ratioDevs[key] = { actual: +actual.toFixed(4), ideal: null, dev: null };
  }

  // rawProportions uses only the 5 active ratios (V3)
  let totalDev = 0, totalW = 0;
  for (let i = 0; i < IDEAL_RATIOS.length; i++) {
    const key = IDEAL_KEYS[i];
    const actual = ratios[key];
    const ideal = IDEAL_RATIOS[i].ideal;
    const w = IDEAL_RATIOS[i].weight;
    const dev = Math.abs(actual - ideal) / ideal;
    ratioDevs[key] = { actual: +actual.toFixed(4), ideal, dev: +dev.toFixed(4) };
    totalDev += dev * w;
    totalW += w;
  }
  const rawProportions = totalDev / totalW;

  // Raw thirds
  const top = lm.foreheadTop.y, brows = lm.browMidpointY;
  const noseBase = lm.noseTip.y, chin = lm.chinBottom.y;
  const upper = Math.abs(brows - top), middle = Math.abs(noseBase - brows), lower = Math.abs(chin - noseBase);
  const total = upper + middle + lower;
  const idealThird = total / 3;
  const rawThirds = total > EPSILON ? {
    upper: +(upper/total*100).toFixed(1),
    middle: +(middle/total*100).toFixed(1),
    lower: +(lower/total*100).toFixed(1),
    deviation: +((Math.abs(upper-idealThird)/idealThird*0.8 + Math.abs(middle-idealThird)/idealThird*1.0 + Math.abs(lower-idealThird)/idealThird*1.2)/3.0 + Math.abs((middle > EPSILON ? lower/middle : 1.0) - 1.0)*0.15).toFixed(4),
  } : null;

  // Raw fifths
  const x0=lm.faceLeftEdge.x, x1=lm.leftEyeOuter.x, x2=lm.leftEyeInner.x;
  const x3=lm.rightEyeInner.x, x4=lm.rightEyeOuter.x, x5=lm.faceRightEdge.x;
  const fifths = [Math.abs(x1-x0), Math.abs(x2-x1), Math.abs(x3-x2), Math.abs(x4-x3), Math.abs(x5-x4)];
  const fifthTotal = fifths.reduce((s,v)=>s+v, 0);
  const idealFifth = fifthTotal / 5;
  const rawFifths = fifths.map((f, i) => +((f/fifthTotal)*100).toFixed(1));

  // Raw jawline components
  const contour = lm.jawContour;
  const midIdx = Math.floor(contour.length / 2);
  const jawAngle = contour.length >= 5 ? angleBetween(contour[0], contour[midIdx], contour[contour.length-1]) : 0;
  const jawW = lm.jawWidth, cheekW = lm.cheekboneWidth;

  // Raw averageness (V3: 5 active ratios)
  let sumSqDev = 0;
  for (let i = 0; i < POPULATION_MEANS.length; i++) {
    const actual = ratios[POP_KEYS[i]];
    const target = POPULATION_MEANS[i].mean;
    const dev = (actual - target) / target;
    sumSqDev += dev * dev;
  }
  const rawAverageness = Math.sqrt(sumSqDev / POPULATION_MEANS.length);

  return {
    rawSymmetry: +rawSymmetry.toFixed(5),
    rawProportions: +rawProportions.toFixed(5),
    rawThirds,
    rawFifths,
    rawAverageness: +rawAverageness.toFixed(5),
    ratios: ratioDevs,
    jawAngleDeg: +(jawAngle * 180 / Math.PI).toFixed(1),
    jawCheekRatio: cheekW > EPSILON ? +(jawW/cheekW).toFixed(3) : null,
    faceHW: +(faceH/faceW).toFixed(3),
    faceH: +faceH.toFixed(4),
    faceW: +faceW.toFixed(4),
    iod: +iod.toFixed(4),
  };
}

export function calculateStructureScore(lm) {
  const symmetry = calculateSymmetry(lm);
  const goldenRatio = calculateGoldenRatio(lm);
  const jawline = calculateJawline(lm);
  const facialThirds = calculateFacialThirds(lm);
  const facialFifths = calculateFacialFifths(lm);
  const averageness = calculateAverageness(lm);
  const harmony = calculateHarmony([symmetry, goldenRatio, jawline, facialThirds, facialFifths]);

  const structureScore =
    symmetry * WEIGHTS.symmetry +
    goldenRatio * WEIGHTS.goldenRatio +
    jawline * WEIGHTS.jawline +
    facialThirds * WEIGHTS.facialThirds +
    facialFifths * WEIGHTS.facialFifths +
    averageness * WEIGHTS.averageness +
    harmony * WEIGHTS.harmony;

  return {
    symmetry,
    goldenRatio,
    jawline,
    facialThirds,
    facialFifths,
    averageness,
    harmony,
    structureScore: clamp(structureScore),
  };
}
