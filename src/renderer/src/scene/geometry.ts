import * as THREE from 'three'

// Geometric constants for the Dejarik board. The board is two concentric
// playable rings of 12 segments each; the innermost circle exists in the prop
// but isn't part of play.

export const R_INNER = 1.6 // outer edge of the (unusable) inner circle
export const R_MIDDLE = 3.0 // boundary between middle ring and outer ring
export const R_OUTER = 4.6 // outer edge of the board
export const BOARD_Y = 0.0

export const SEG_COUNT = 12
export const SEG_ANGLE = (Math.PI * 2) / SEG_COUNT

// Angle (radians) at the centre of segment `seg`. Seg 0 sits at the
// "south" of the board (toward the local +Z axis as the camera looks down
// the -Z axis), so Blue's home half (segments 9..2) faces the viewer.
export function segCentreAngle(seg: number): number {
  return seg * SEG_ANGLE + Math.PI / 2
}

export function ringMidRadius(ring: 0 | 1): number {
  // ring 0 = outer ring, ring 1 = middle ring
  return ring === 0 ? (R_MIDDLE + R_OUTER) / 2 : (R_INNER + R_MIDDLE) / 2
}

export function ringInnerRadius(ring: 0 | 1): number {
  return ring === 0 ? R_MIDDLE : R_INNER
}

export function ringOuterRadius(ring: 0 | 1): number {
  return ring === 0 ? R_OUTER : R_MIDDLE
}

export function cellCentre(ring: 0 | 1, seg: number, y = BOARD_Y + 0.06): THREE.Vector3 {
  const r = ringMidRadius(ring)
  const a = segCentreAngle(seg)
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
}

// Build a ring-segment (annular wedge) mesh on the y=BOARD_Y plane. Useful for
// both decorative segment outlines and invisible click hit-targets.
export function segmentShape(ring: 0 | 1, seg: number, inset = 0.04): THREE.Shape {
  const rIn = ringInnerRadius(ring) + inset
  const rOut = ringOuterRadius(ring) - inset
  const a0 = seg * SEG_ANGLE - SEG_ANGLE / 2 + Math.PI / 2 + inset * 0.05
  const a1 = a0 + SEG_ANGLE - inset * 0.1
  const shape = new THREE.Shape()
  shape.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut)
  // outer arc
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const a = a0 + (a1 - a0) * t
    shape.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut)
  }
  shape.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const a = a1 - (a1 - a0) * t
    shape.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn)
  }
  shape.lineTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut)
  return shape
}
