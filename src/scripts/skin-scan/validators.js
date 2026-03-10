/**
 * Head pose and expression validators.
 * Port 1:1 from Visevo Flutter app.
 */

// --- Head Pose Validator ---
// Thresholds calibrated on OPPO A54s (2026-03)

const ROLL_THRESHOLD = 0.26;   // radians (~15 degrees)
const YAW_THRESHOLD = 0.10;    // ratio (Z-depth asymmetry / face width)
const PITCH_THRESHOLD = 0.12;  // ratio (Z-depth diff / face height)

/**
 * Validate head pose from 3D landmark positions.
 * @param {object} lm — parsed landmarks
 * @returns {'frontal'|'rolled'|'yawLeft'|'yawRight'|'pitchUp'|'pitchDown'}
 */
export function validateHeadPose(lm) {
  // Roll: angle of eye line vs horizontal (2D, most reliable)
  const rollAngle = Math.atan2(
    lm.rightEyeOuter.y - lm.leftEyeOuter.y,
    lm.rightEyeOuter.x - lm.leftEyeOuter.x
  );
  if (Math.abs(rollAngle) > ROLL_THRESHOLD) {
    return 'rolled';
  }

  // Yaw: Z asymmetry between left/right eyes
  const zDiff = (lm.leftEyeOuter.z || 0) - (lm.rightEyeOuter.z || 0);
  if (lm.faceWidth > 0) {
    const yawRatio = zDiff / lm.faceWidth;
    if (yawRatio > YAW_THRESHOLD) return 'yawLeft';
    if (yawRatio < -YAW_THRESHOLD) return 'yawRight';
  }

  // Pitch: Z depth ratio between nose tip and bridge
  const pitchDiff = (lm.noseTip.z || 0) - (lm.noseBridgeTop.z || 0);
  if (lm.faceHeight > 0) {
    const pitchRatio = pitchDiff / lm.faceHeight;
    if (pitchRatio > PITCH_THRESHOLD) return 'pitchDown';
    if (pitchRatio < -PITCH_THRESHOLD) return 'pitchUp';
  }

  return 'frontal';
}

// --- Expression Validator ---
// Blendshape indices (MediaPipe 52-blendshape set)

const MOUTH_SMILE_LEFT = 44;
const MOUTH_SMILE_RIGHT = 45;
const EYE_BLINK_LEFT = 9;
const EYE_BLINK_RIGHT = 10;

const SMILE_THRESHOLD = 0.3;
const BLINK_THRESHOLD = 0.4;

/**
 * Validate facial expression from blendshapes.
 * @param {number[]|null} blendshapes — 52-element array of blendshape values [0, 1]
 * @returns {'neutral'|'smiling'|'eyesClosed'}
 */
export function validateExpression(blendshapes) {
  if (!blendshapes || blendshapes.length < 52) return 'neutral';

  const eyesClosed =
    blendshapes[EYE_BLINK_LEFT] > BLINK_THRESHOLD &&
    blendshapes[EYE_BLINK_RIGHT] > BLINK_THRESHOLD;

  if (eyesClosed) return 'eyesClosed';

  const isSmiling =
    blendshapes[MOUTH_SMILE_LEFT] > SMILE_THRESHOLD ||
    blendshapes[MOUTH_SMILE_RIGHT] > SMILE_THRESHOLD;

  if (isSmiling) return 'smiling';

  return 'neutral';
}

// Pose messages for UI display
export const POSE_MESSAGES = {
  frontal: '',
  rolled: 'Keep your head level',
  yawLeft: 'Turn slightly to face the camera',
  yawRight: 'Turn slightly to face the camera',
  pitchUp: 'Lower your chin slightly',
  pitchDown: 'Raise your chin slightly',
};

export const EXPRESSION_MESSAGES = {
  neutral: '',
  smiling: 'Try a neutral expression for best accuracy',
  eyesClosed: 'Open your eyes for the analysis',
};
