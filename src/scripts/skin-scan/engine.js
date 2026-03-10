/**
 * Skin Scan Engine — MediaPipe Face Landmarker + skin analysis orchestrator.
 * MediaPipe Face Landmarker + skin analysis pipeline.
 */

import { parseLandmarks } from './landmarks.js';
import { validateHeadPose, validateExpression, POSE_MESSAGES, EXPRESSION_MESSAGES } from './validators.js';
import { assessPhotoQuality, generateQualityFeedback } from './quality-assessor.js';
import { analyzeSkin } from './skin-analyzer.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let faceLandmarker = null;

/**
 * Initialize MediaPipe Face Landmarker.
 * @param {function} onProgress — optional progress callback
 */
export async function initEngine(onProgress) {
  if (faceLandmarker) return;

  if (onProgress) onProgress('Loading AI model...');

  const vision = await import('@mediapipe/tasks-vision');
  const FaceLandmarkerClass = vision.FaceLandmarker;
  const FilesetResolver = vision.FilesetResolver;

  if (onProgress) onProgress('Loading WASM runtime...');
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_CDN);

  if (onProgress) onProgress('Loading face model...');

  // GPU first, CPU fallback
  try {
    faceLandmarker = await FaceLandmarkerClass.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  } catch (gpuErr) {
    console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
    faceLandmarker = await FaceLandmarkerClass.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  }

  if (onProgress) onProgress('Model ready');
}

/**
 * Analyze a face image for skin metrics.
 * @param {HTMLCanvasElement} canvas — canvas with the face image drawn on it
 * @returns {object} Skin analysis results or error
 */
export async function analyzeFace(canvas) {
  if (!faceLandmarker) {
    throw new Error('Engine not initialized. Call initEngine() first.');
  }

  const result = faceLandmarker.detect(canvas);

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { error: 'no_face', message: 'No face detected. Please try a clearer photo.' };
  }

  const landmarks478 = result.faceLandmarks[0];
  const blendshapes = result.faceBlendshapes?.[0]?.categories?.map((c) => c.score) ?? null;

  // Parse landmarks
  const lm = parseLandmarks(landmarks478);
  if (!lm) {
    return { error: 'invalid_landmarks', message: 'Could not process face landmarks.' };
  }

  // Validate head pose
  const headPose = validateHeadPose(lm);
  if (headPose !== 'frontal') {
    return {
      error: 'bad_pose',
      message: POSE_MESSAGES[headPose] || 'Please face the camera directly.',
    };
  }

  // Validate expression
  const expression = validateExpression(blendshapes);

  // Get image data for pixel analysis
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Run skin analysis
  const skinMetrics = analyzeSkin(imageData, landmarks478, canvas.width, canvas.height);

  // Photo quality (for potential future use)
  const imageWidth = canvas.width;
  const imageHeight = canvas.height;
  const quality = assessPhotoQuality(lm, imageWidth, imageHeight, blendshapes);
  const { warnings } = generateQualityFeedback(quality);

  return {
    error: null,
    skinMetrics,
    landmarks: landmarks478,
    headPose,
    expression,
    expressionWarning: EXPRESSION_MESSAGES[expression] || '',
    quality: {
      signals: quality.signals,
      overallConfidence: quality.overallConfidence,
    },
    qualityWarnings: warnings,
  };
}

/**
 * Check if engine is ready.
 */
export function isEngineReady() {
  return faceLandmarker !== null;
}
