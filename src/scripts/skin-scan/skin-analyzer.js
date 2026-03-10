/**
 * Skin Analyzer — pixel-based skin metrics using MediaPipe landmarks.
 * Ports core algorithms from Visevo Flutter skin calculators to JavaScript.
 */

// --- Zone definitions (MediaPipe landmark indices) ---

const ZONES = {
  forehead:   [10, 67, 69, 104, 108, 151, 297, 299, 333, 337],
  leftCheek:  [116, 123, 132, 147, 187, 205],
  rightCheek: [345, 352, 361, 376, 411, 425],
  chin:       [152, 172, 397, 175, 396, 150, 149, 176, 148],
  nose:       [1, 6, 49, 279, 98, 327],
};

const UNDER_EYE_INDICES = [111, 117, 118, 119, 120, 121, 128, 245, 340, 346, 347, 348, 349, 350, 357, 465];
const CHEEK_REF_INDICES = [116, 123, 132, 147, 187, 205, 345, 352, 361, 376, 411, 425];

const SAMPLE_RADIUS = 8;

const COMPLIMENTS = {
  luminosity:   'Your skin has a healthy, natural glow',
  toneEvenness: 'Your skin tone is remarkably even',
  underEye:     'Your under-eye area looks fresh and well-rested',
  redness:      'Your skin shows excellent clarity',
  texture:      'Your skin texture is smooth and refined',
};

// --- Color conversion ---

/**
 * sRGB [0-255] -> CIE Lab.
 * Port of Visevo FaceImageReader._rgbToLab (face_image_reader.dart:151-188)
 */
function rgbToLab(r, g, b) {
  // Step 1: sRGB -> linear
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

  // Step 2: Linear RGB -> XYZ (D65)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / 1.00000;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;

  // Step 3: XYZ -> Lab
  const fx = x > 0.008856 ? Math.cbrt(x) : (903.3 * x + 16) / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : (903.3 * y + 16) / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : (903.3 * z + 16) / 116;

  return {
    l: Math.max(0, Math.min(100, 116 * fy - 16)),
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

// --- Pixel sampling ---

/**
 * Sample pixels in a radius around a landmark position.
 * Returns array of { r, g, b } values.
 */
function samplePixels(imageData, lx, ly, radius, canvasWidth, canvasHeight) {
  const px = Math.round(lx * canvasWidth);
  const py = Math.round(ly * canvasHeight);
  const pixels = [];
  const data = imageData.data;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) continue;
      if (dx * dx + dy * dy > radius * radius) continue; // circular mask

      const idx = (y * canvasWidth + x) * 4;
      pixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  return pixels;
}

/**
 * Sample Lab values for a set of landmark indices.
 */
function sampleZoneLab(imageData, landmarks, indices, canvasWidth, canvasHeight) {
  const labValues = [];
  for (const idx of indices) {
    if (idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    const pixels = samplePixels(imageData, lm.x, lm.y, SAMPLE_RADIUS, canvasWidth, canvasHeight);
    for (const p of pixels) {
      labValues.push(rgbToLab(p.r, p.g, p.b));
    }
  }
  return labValues;
}

// --- Metric calculations ---

/**
 * Luminosity score. Port of luminosity_calculator.dart:28-76
 */
function calcLuminosity(allLabValues) {
  if (allLabValues.length === 0) return 50;

  const meanL = allLabValues.reduce((sum, v) => sum + v.l, 0) / allLabValues.length;

  // Brightness score (piecewise)
  let brightnessScore;
  if (meanL < 30) {
    brightnessScore = (meanL / 30) * 40;
  } else if (meanL <= 80) {
    brightnessScore = 40 + ((meanL - 30) / 50) * 60;
  } else {
    brightnessScore = 100 - ((meanL - 80) / 20) * 15;
  }

  // Glow bonus
  const highlightCount = allLabValues.filter(v => v.l > 70).length;
  const highlightRatio = highlightCount / allLabValues.length;
  const glowBonus = Math.min(highlightRatio * 10, 10);

  return clamp(brightnessScore * 0.85 + glowBonus * 1.5, 0, 100);
}

/**
 * Tone Evenness score. Port of tone_evenness_calculator.dart:38-127
 */
function calcToneEvenness(zoneMeanL) {
  const validZones = Object.values(zoneMeanL).filter(v => v !== null);
  if (validZones.length < 2) return 50;

  const mean = validZones.reduce((s, v) => s + v, 0) / validZones.length;
  const variance = validZones.reduce((s, v) => s + (v - mean) ** 2, 0) / validZones.length;
  const stddev = Math.sqrt(variance);

  return clamp(100 - stddev * 5, 10, 100);
}

/**
 * Under-Eye score. Port of under_eye_calculator.dart:16-100
 */
function calcUnderEye(imageData, landmarks, canvasWidth, canvasHeight) {
  const underEyeLab = sampleZoneLab(imageData, landmarks, UNDER_EYE_INDICES, canvasWidth, canvasHeight);
  const cheekLab = sampleZoneLab(imageData, landmarks, CHEEK_REF_INDICES, canvasWidth, canvasHeight);

  if (underEyeLab.length === 0 || cheekLab.length === 0) return 50;

  const underEyeL = underEyeLab.reduce((s, v) => s + v.l, 0) / underEyeLab.length;
  const cheekL = cheekLab.reduce((s, v) => s + v.l, 0) / cheekLab.length;
  const deltaL = cheekL - underEyeL;

  // Piecewise linear scoring
  if (deltaL <= 0) return 100;
  if (deltaL <= 2) return 95 + (2 - deltaL) / 2 * 5;
  if (deltaL <= 5) return 80 + (5 - deltaL) / 3 * 15;
  if (deltaL <= 10) return 60 + (10 - deltaL) / 5 * 20;
  if (deltaL <= 15) return 40 + (15 - deltaL) / 5 * 20;
  if (deltaL <= 20) return 20 + (20 - deltaL) / 5 * 20;
  return clamp(10 + (25 - deltaL) / 5 * 10, 10, 20);
}

/**
 * Redness score. Port of redness_calculator.dart:15-53
 */
function calcRedness(allLabValues) {
  if (allLabValues.length === 0) return 50;

  const meanA = allLabValues.reduce((s, v) => s + v.a, 0) / allLabValues.length;
  return clamp(100 * (1 - (meanA - 5) / (33 - 5)), 0, 100);
}

/**
 * Texture score. Port of texture_calculator.dart:12-80
 * Uses local luminance variance of 5x5 patches.
 */
function calcTexture(imageData, landmarks, zoneIndices, canvasWidth, canvasHeight) {
  const allIndices = Object.values(zoneIndices).flat();
  const variances = [];

  for (const idx of allIndices) {
    if (idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    const px = Math.round(lm.x * canvasWidth);
    const py = Math.round(lm.y * canvasHeight);
    const patchSize = 5;
    const half = Math.floor(patchSize / 2);
    const luminances = [];

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) continue;
        const i = (y * canvasWidth + x) * 4;
        const lum = 0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2];
        luminances.push(lum);
      }
    }

    if (luminances.length > 1) {
      const mean = luminances.reduce((s, v) => s + v, 0) / luminances.length;
      const variance = luminances.reduce((s, v) => s + (v - mean) ** 2, 0) / luminances.length;
      variances.push(variance);
    }
  }

  if (variances.length === 0) return 50;
  const avgVariance = variances.reduce((s, v) => s + v, 0) / variances.length;

  // Score: low variance = smooth skin
  if (avgVariance <= 50) return 100;
  if (avgVariance >= 400) return 20;
  return 100 - ((avgVariance - 50) / (400 - 50)) * 80;
}

// --- Helper ---

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// --- Main analysis function ---

/**
 * Analyze skin from image data and MediaPipe landmarks.
 * @param {ImageData} imageData — full canvas pixel data
 * @param {Array<{x: number, y: number, z: number}>} landmarks — 478 normalized landmarks
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {object} Skin analysis results
 */
export function analyzeSkin(imageData, landmarks, canvasWidth, canvasHeight) {
  // Collect Lab values per zone
  const zoneLab = {};
  const allLab = [];
  const zoneMeanL = {};

  for (const [zoneName, indices] of Object.entries(ZONES)) {
    const labValues = sampleZoneLab(imageData, landmarks, indices, canvasWidth, canvasHeight);
    zoneLab[zoneName] = labValues;
    allLab.push(...labValues);

    if (labValues.length > 0) {
      zoneMeanL[zoneName] = labValues.reduce((s, v) => s + v.l, 0) / labValues.length;
    } else {
      zoneMeanL[zoneName] = null;
    }
  }

  // Calculate 5 metrics
  const luminosity = Math.round(calcLuminosity(allLab));
  const toneEvenness = Math.round(calcToneEvenness(zoneMeanL));
  const underEye = Math.round(calcUnderEye(imageData, landmarks, canvasWidth, canvasHeight));
  const redness = Math.round(calcRedness(allLab));
  const texture = Math.round(calcTexture(imageData, landmarks, ZONES, canvasWidth, canvasHeight));

  const metrics = { luminosity, toneEvenness, underEye, redness, texture };

  // Find best metric
  let bestKey = 'luminosity';
  let bestScore = 0;
  for (const [key, score] of Object.entries(metrics)) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  // Count improvement areas (score < 50)
  const improvementCount = Object.values(metrics).filter(s => s < 50).length;

  // Zone scores for heatmap (average L* mapped to 0-100)
  const zoneScores = {};
  for (const [zoneName, meanL] of Object.entries(zoneMeanL)) {
    if (meanL !== null) {
      // Map L* to a rough quality score (centered skin L* ~50-65 is ideal)
      const labVals = zoneLab[zoneName];
      const zoneA = labVals.length > 0 ? labVals.reduce((s, v) => s + v.a, 0) / labVals.length : 10;
      // Combine: good L* (40-70) and low redness
      const lScore = meanL >= 40 && meanL <= 70 ? 80 : (meanL < 40 ? meanL * 2 : 100 - (meanL - 70));
      const aScore = clamp(100 * (1 - (zoneA - 5) / (33 - 5)), 0, 100);
      zoneScores[zoneName] = Math.round((lScore * 0.6 + aScore * 0.4));
    } else {
      zoneScores[zoneName] = 50;
    }
  }

  return {
    luminosity,
    toneEvenness,
    underEye,
    redness,
    texture,
    bestMetric: {
      name: bestKey,
      score: bestScore,
      compliment: COMPLIMENTS[bestKey],
    },
    improvementCount: Math.max(improvementCount, 1), // always tease at least 1
    zoneScores,
  };
}

export { ZONES, rgbToLab };
