/**
 * Face Analysis Engine — orchestrates MediaPipe + score calculators.
 * Entry point for the /try page.
 */

import { parseLandmarks } from './landmarks.js';
import { calculateStructureScore, extractRawMetrics } from './calculators.js';
import { classifyFaceShape, SHAPE_DESCRIPTIONS } from './classifier.js';
import { validateHeadPose, validateExpression, POSE_MESSAGES, EXPRESSION_MESSAGES } from './validators.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let faceLandmarker = null;
let FaceLandmarkerClass = null;

/**
 * Initialize MediaPipe Face Landmarker.
 * Downloads WASM assets (~4MB) on first call.
 * @param {function} onProgress — optional progress callback
 */
export async function initEngine(onProgress) {
  if (faceLandmarker) return;

  if (onProgress) onProgress('Loading AI model...');

  // Dynamic import — code-split, only loaded on /try page
  const vision = await import('@mediapipe/tasks-vision');
  FaceLandmarkerClass = vision.FaceLandmarker;
  const FilesetResolver = vision.FilesetResolver;

  if (onProgress) onProgress('Loading WASM runtime...');
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_CDN);

  if (onProgress) onProgress('Loading face model...');

  // Try GPU first, fall back to CPU
  try {
    faceLandmarker = await FaceLandmarkerClass.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  } catch (gpuErr) {
    console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
    faceLandmarker = await FaceLandmarkerClass.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  }

  if (onProgress) onProgress('Model ready');
}

/**
 * Analyze a face image.
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement — the image to analyze
 * @returns {object} Analysis result with scores, face shape, pose, expression
 */
export async function analyzeImage(imageElement) {
  if (!faceLandmarker) {
    throw new Error('Engine not initialized. Call initEngine() first.');
  }

  const result = faceLandmarker.detect(imageElement);

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { error: 'no_face', message: 'No face detected. Please try a clearer photo.' };
  }

  const landmarks478 = result.faceLandmarks[0];
  const blendshapes = result.faceBlendshapes?.[0]?.categories?.map((c) => c.score) ?? null;

  // Parse landmarks into structured data
  const lm = parseLandmarks(landmarks478);
  if (!lm) {
    return { error: 'invalid_landmarks', message: 'Could not process face landmarks.' };
  }

  // Validate head pose
  const headPose = validateHeadPose(lm);
  const poseWarning = POSE_MESSAGES[headPose] || '';

  // Validate expression
  const expression = validateExpression(blendshapes);
  const expressionWarning = EXPRESSION_MESSAGES[expression] || '';

  // Calculate all structure scores
  const scores = calculateStructureScore(lm);

  // Debug: extract raw metrics (pre-calibration)
  const rawMetrics = extractRawMetrics(lm);
  console.log('[VISEVO DEBUG] Raw metrics:', JSON.stringify(rawMetrics, null, 2));
  console.log('[VISEVO DEBUG] Calibrated scores:', JSON.stringify(scores, null, 2));

  // Classify face shape
  const { shape, confidence } = classifyFaceShape(lm);
  const shapeDescription = SHAPE_DESCRIPTIONS[shape] || '';

  return {
    error: null,
    glowScore: Math.round(scores.structureScore),
    scores: {
      symmetry: Math.round(scores.symmetry),
      goldenRatio: Math.round(scores.goldenRatio),
      jawline: Math.round(scores.jawline),
      facialThirds: Math.round(scores.facialThirds),
      facialFifths: Math.round(scores.facialFifths),
      averageness: Math.round(scores.averageness),
      harmony: Math.round(scores.harmony),
    },
    faceShape: {
      type: shape,
      description: shapeDescription,
      confidence,
    },
    headPose,
    poseWarning,
    expression,
    expressionWarning,
  };
}

/**
 * Check if engine is ready.
 */
export function isEngineReady() {
  return faceLandmarker !== null;
}
