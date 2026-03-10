/**
 * FaceLandmarks — parses MediaPipe 478-point face mesh into named landmarks.
 * Port 1:1 from Visevo Flutter app (lib/features/scan/analysis/face_landmarks.dart).
 */

// Named landmark indices (MediaPipe 478-point topology)
const IDX = {
  upperLipTop: 0,
  noseTip: 1,
  noseBridgeTop: 6,
  foreheadTop: 10,
  lowerLipBottom: 17,
  leftEyeOuter: 33,
  noseAlarLeft: 49,
  jawLeft: 58,
  lipLeft: 61,
  browMidLeft: 66,
  noseBaseLeft: 98,
  browOuterLeft: 105,
  browInnerLeft: 107,
  cheekboneMidLeft: 116,
  cheekboneLowerLeft: 123,
  templeLeft: 127,
  eyeOuterLowerInnerLeft: 130,
  jawUpperLeft: 132,
  leftEyeInner: 133,
  chinBottom: 152,
  lowerJawLeft: 172,
  faceLeftEdge: 234,
  eyeOuterLowerOuterLeft: 243,
  rightEyeOuter: 263,
  noseAlarRight: 279,
  jawRight: 288,
  lipRight: 291,
  browMidRight: 296,
  lowerLipRight: 318,
  noseBaseRight: 327,
  browOuterRight: 334,
  browInnerRight: 336,
  cheekboneMidRight: 345,
  cheekboneLowerRight: 352,
  templeRight: 356,
  eyeOuterLowerInnerRight: 359,
  jawUpperRight: 361,
  rightEyeInner: 362,
  lowerJawRight: 397,
  upperCheekLeft: 46,
  upperCheekRight: 276,
  upperLipLeft: 40,
  upperLipRight: 270,
  lowerLipLeft: 88,
  faceRightEdge: 454,
  eyeOuterLowerOuterRight: 463,
};

// 19 bilateral symmetry pairs
export const SYMMETRY_PAIRS = [
  [33, 263],   // leftEyeOuter, rightEyeOuter
  [133, 362],  // leftEyeInner, rightEyeInner
  [130, 359],  // eyeOuterLower inner L/R
  [243, 463],  // eyeOuterLower outer L/R
  [107, 336],  // browInner L/R
  [66, 296],   // browMid L/R
  [105, 334],  // browOuter L/R
  [46, 276],   // upperCheek L/R
  [116, 345],  // midCheek L/R
  [123, 352],  // lowerCheek L/R
  [98, 327],   // noseBase L/R
  [49, 279],   // noseAlar L/R
  [61, 291],   // lipCorner L/R
  [40, 270],   // upperLip L/R
  [88, 318],   // lowerLip L/R
  [58, 288],   // jawAngle L/R
  [172, 397],  // lowerJawMid L/R
  [132, 361],  // jawUpper L/R
  [127, 356],  // temple L/R
];

// Jaw contour indices (17 points, left-to-top-to-right)
export const JAW_CONTOUR = [
  234, 127, 162, 21, 54, 103, 67, 109, 10,
  338, 297, 332, 284, 251, 389, 356, 454,
];

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Parse MediaPipe FaceLandmarker result into structured landmarks.
 * @param {Array<{x: number, y: number, z: number}>} points — 478 normalized landmarks
 * @returns {object} Structured landmarks with named points and computed distances
 */
export function parseLandmarks(points) {
  if (!points || points.length < 468) {
    return null;
  }

  const p = (idx) => points[idx];

  const foreheadTop = p(IDX.foreheadTop);
  const chinBottom = p(IDX.chinBottom);
  const faceLeftEdge = p(IDX.faceLeftEdge);
  const faceRightEdge = p(IDX.faceRightEdge);
  const leftEyeInner = p(IDX.leftEyeInner);
  const rightEyeInner = p(IDX.rightEyeInner);
  const leftEyeOuter = p(IDX.leftEyeOuter);
  const rightEyeOuter = p(IDX.rightEyeOuter);
  const noseTip = p(IDX.noseTip);
  const noseBridgeTop = p(IDX.noseBridgeTop);
  const noseBaseLeft = p(IDX.noseBaseLeft);
  const noseBaseRight = p(IDX.noseBaseRight);
  const lipLeft = p(IDX.lipLeft);
  const lipRight = p(IDX.lipRight);
  const upperLipTop = p(IDX.upperLipTop);
  const lowerLipBottom = p(IDX.lowerLipBottom);
  const templeLeft = p(IDX.templeLeft);
  const templeRight = p(IDX.templeRight);
  const jawLeft = p(IDX.jawLeft);
  const jawRight = p(IDX.jawRight);
  const cheekboneLeft = p(IDX.cheekboneMidLeft);
  const cheekboneRight = p(IDX.cheekboneMidRight);
  const browInnerLeft = p(IDX.browInnerLeft);
  const browInnerRight = p(IDX.browInnerRight);

  const faceHeight = dist2d(foreheadTop, chinBottom);
  const faceWidth = dist2d(faceLeftEdge, faceRightEdge);
  const interocularDistance = dist2d(leftEyeInner, rightEyeInner);
  const noseWidth = dist2d(noseBaseLeft, noseBaseRight);
  const lipWidth = dist2d(lipLeft, lipRight);
  const foreheadWidth = dist2d(templeLeft, templeRight);
  const jawWidth = dist2d(jawLeft, jawRight);
  const cheekboneWidth = dist2d(cheekboneLeft, cheekboneRight);
  const chinLength = dist2d(lowerLipBottom, chinBottom);
  const lowerJawWidth = dist2d(p(IDX.lowerJawLeft), p(IDX.lowerJawRight));

  const midlineX = (leftEyeInner.x + rightEyeInner.x) / 2;
  const browMidpointY = (browInnerLeft.y + browInnerRight.y) / 2;

  const jawContour = JAW_CONTOUR.map((idx) => points[idx]);

  return {
    points,
    // Named points
    foreheadTop,
    chinBottom,
    faceLeftEdge,
    faceRightEdge,
    leftEyeInner,
    rightEyeInner,
    leftEyeOuter,
    rightEyeOuter,
    noseTip,
    noseBridgeTop,
    noseBaseLeft,
    noseBaseRight,
    lipLeft,
    lipRight,
    upperLipTop,
    lowerLipBottom,
    templeLeft,
    templeRight,
    jawLeft,
    jawRight,
    cheekboneLeft,
    cheekboneRight,
    browInnerLeft,
    browInnerRight,
    // Computed distances
    faceHeight,
    faceWidth,
    interocularDistance,
    noseWidth,
    lipWidth,
    foreheadWidth,
    jawWidth,
    cheekboneWidth,
    chinLength,
    lowerJawWidth,
    midlineX,
    browMidpointY,
    jawContour,
  };
}

export { dist, dist2d, IDX };
