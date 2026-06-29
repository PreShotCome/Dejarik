import * as THREE from 'three'
import type { PieceType, Team } from '../game/types'

// Procedural holographic-looking creature meshes. We've got no 3D models, so
// each piece type is built from a handful of primitives in a recognisably
// distinct silhouette:
//
//   scout    — slim biped: skinny body + small head + two raised arms
//   brute    — beefy quadruped: thick torso + shoulders + low head
//   guardian — wide dome with crest, low and defensive
//   predator — tall spiked pyramid + curving claws, aggressive
//
// All pieces share a holographic shader: emissive base + faint scanlines,
// alpha-blended so they glow. Team colour drives the hue.

const BLUE = new THREE.Color(0x36c8ff)
const RED = new THREE.Color(0xff5e7a)

export function teamColour(team: Team): THREE.Color {
  return team === 'blue' ? BLUE.clone() : RED.clone()
}

function holoMaterial(team: Team, accent = 0): THREE.MeshStandardMaterial {
  const c = teamColour(team)
  // gently shift hue per-piece-type so the four piece classes aren't identical
  // shade. accent in degrees (0..120) added to hue.
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL((hsl.h + accent / 360 + 1) % 1, Math.min(1, hsl.s * 1.05), hsl.l)
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: c.clone().multiplyScalar(0.55),
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.92,
    roughness: 0.35,
    metalness: 0.15
  })
}

function pedestal(team: Team): THREE.Mesh {
  const c = teamColour(team)
  const mat = new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.7),
    emissive: c.clone().multiplyScalar(0.3),
    transparent: true,
    opacity: 0.6,
    roughness: 0.6,
    metalness: 0.2
  })
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 24), mat)
  m.position.y = 0.04
  return m
}

function buildScout(team: Team): THREE.Group {
  const g = new THREE.Group()
  g.add(pedestal(team))
  const mat = holoMaterial(team, 0)
  // body — tall narrow ellipsoid
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 14), mat)
  body.position.y = 0.45
  g.add(body)
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat)
  head.position.y = 0.92
  g.add(head)
  // two raised arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 8), mat)
    arm.position.set(side * 0.2, 0.62, 0)
    arm.rotation.z = (side * Math.PI) / 3
    g.add(arm)
  }
  // tail / sensor
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 8), mat)
  tail.position.set(0, 1.18, 0)
  g.add(tail)
  return g
}

function buildBrute(team: Team): THREE.Group {
  const g = new THREE.Group()
  g.add(pedestal(team))
  const mat = holoMaterial(team, 30)
  // chunky torso
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), mat)
  torso.scale.set(1.1, 0.9, 1.0)
  torso.position.y = 0.5
  g.add(torso)
  // shoulders
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), mat)
    sh.position.set(side * 0.42, 0.72, 0)
    g.add(sh)
    // arms hanging down
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.55, 10), mat)
    arm.position.set(side * 0.5, 0.4, 0)
    g.add(arm)
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), mat)
    fist.position.set(side * 0.55, 0.15, 0)
    g.add(fist)
  }
  // low head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), mat)
  head.position.set(0, 0.95, 0.05)
  g.add(head)
  return g
}

function buildGuardian(team: Team): THREE.Group {
  const g = new THREE.Group()
  g.add(pedestal(team))
  const mat = holoMaterial(team, 60)
  // wide low dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat)
  dome.position.y = 0.15
  g.add(dome)
  // crest along top
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.7), mat)
  crest.position.y = 0.5
  g.add(crest)
  // four stout legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.18, 8), mat)
      leg.position.set(sx * 0.3, 0.12, sz * 0.25)
      g.add(leg)
    }
  }
  return g
}

function buildPredator(team: Team): THREE.Group {
  const g = new THREE.Group()
  g.add(pedestal(team))
  const mat = holoMaterial(team, 100)
  // sharp central spike
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.05, 16), mat)
  spike.position.y = 0.62
  g.add(spike)
  // ribbed body around the base
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.4, 14), mat)
  torso.position.y = 0.28
  g.add(torso)
  // two curving claws
  for (const side of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 14, Math.PI / 1.4), mat)
    claw.position.set(side * 0.36, 0.45, 0)
    claw.rotation.set(Math.PI / 2, 0, side === 1 ? -0.4 : 0.4 + Math.PI)
    g.add(claw)
  }
  // crown ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), mat)
  ring.position.y = 1.08
  ring.rotation.x = Math.PI / 2
  g.add(ring)
  return g
}

export function buildPieceMesh(type: PieceType, team: Team): THREE.Group {
  switch (type) {
    case 'scout':
      return buildScout(team)
    case 'brute':
      return buildBrute(team)
    case 'guardian':
      return buildGuardian(team)
    case 'predator':
      return buildPredator(team)
  }
}

// Walks a piece group and tweaks emissive intensity (selection / highlight
// pulse). We can't tag materials by reference because each piece has many of
// them; we just iterate the group's meshes.
export function setPieceGlow(group: THREE.Group, intensity: number): void {
  group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && 'emissiveIntensity' in m) m.emissiveIntensity = intensity
  })
}
