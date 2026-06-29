import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GameState, Piece, Pos } from '../game/types'
import { posKey } from '../game/board'
import { legalAttacks, legalMoves, pieceById } from '../game/engine'
import { buildPieceMesh, setPieceGlow } from './pieceMesh'
import {
  BOARD_Y,
  R_INNER,
  R_OUTER,
  cellCentre,
  segmentShape
} from './geometry'

export type ClickEvent =
  | { kind: 'piece'; pieceId: string }
  | { kind: 'cell'; pos: Pos }
  | { kind: 'empty' }

interface Props {
  state: GameState
  selectedId: string | null
  onClick: (e: ClickEvent) => void
}

// One scene per mount. State changes drive sync; the scene lives across them.
function Board3D({ state, selectedId, onClick }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  // Latest values for the click handler / animation closures.
  const stateRef = useRef(state)
  const selectedRef = useRef(selectedId)
  const onClickRef = useRef(onClick)
  stateRef.current = state
  selectedRef.current = selectedId
  onClickRef.current = onClick

  // Mutable scene refs the effect below populates and the syncer reads.
  const sceneRefs = useRef<{
    scene: THREE.Scene
    pieceGroup: THREE.Group
    cellMeshes: Map<string, THREE.Mesh> // posKey -> highlight mesh
    cellHitMeshes: THREE.Mesh[] // pickable cell tiles
    pieceMeshes: Map<string, THREE.Group> // pieceId -> mesh
    pieceTargets: Map<string, THREE.Vector3> // smooth-move targets
    pieceFades: Map<string, number> // pieceId -> remaining-fade (1->0)
  } | null>(null)

  // Build the scene once.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200)
    camera.position.set(0, 9.2, 9.6)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.setSize(mount.clientWidth, mount.clientHeight, false)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.enablePan = false
    controls.minDistance = 6
    controls.maxDistance = 22
    controls.maxPolarAngle = Math.PI / 2.05
    controls.minPolarAngle = Math.PI / 6
    controls.autoRotate = false

    // ---- lighting ----------------------------------------------------------
    const ambient = new THREE.AmbientLight(0x6a7da0, 0.45)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xa3d2ff, 0.7)
    key.position.set(6, 10, 4)
    scene.add(key)
    const rim = new THREE.PointLight(0xff6a8a, 0.6, 30, 1.6)
    rim.position.set(-5, 3, -4)
    scene.add(rim)

    // ---- holographic table base -------------------------------------------
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(R_OUTER + 0.7, R_OUTER + 1.1, 0.5, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0a1424,
        emissive: 0x0a1c34,
        emissiveIntensity: 0.4,
        roughness: 0.7,
        metalness: 0.4
      })
    )
    base.position.y = BOARD_Y - 0.28
    scene.add(base)

    // Inner unusable disc (visually marked so it's clear it's off-limits)
    const innerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(R_INNER - 0.1, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1a2840,
        emissive: 0x2a4a78,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide
      })
    )
    innerDisc.rotation.x = -Math.PI / 2
    innerDisc.position.y = BOARD_Y + 0.02
    scene.add(innerDisc)

    // Outer ring rim
    const rim2 = new THREE.Mesh(
      new THREE.RingGeometry(R_OUTER - 0.02, R_OUTER + 0.18, 64),
      new THREE.MeshStandardMaterial({
        color: 0x2eb6ff,
        emissive: 0x2eb6ff,
        emissiveIntensity: 1.3,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
      })
    )
    rim2.rotation.x = -Math.PI / 2
    rim2.position.y = BOARD_Y + 0.04
    scene.add(rim2)

    // ---- cell tiles (one per playable square) -----------------------------
    // Each tile is two layered meshes:
    //   - decor: a thin coloured fill that we tint based on highlight state
    //   - hit:   a transparent picker mesh stretched ever so slightly above
    const cellMeshes = new Map<string, THREE.Mesh>()
    const cellHitMeshes: THREE.Mesh[] = []
    for (const ring of [0, 1] as const) {
      for (let seg = 0; seg < 12; seg++) {
        const shape = segmentShape(ring, seg)
        const geo = new THREE.ShapeGeometry(shape, 6)
        // The shape is in the XY plane; rotate to XZ.
        const mat = new THREE.MeshStandardMaterial({
          color: 0x0d2740,
          emissive: 0x0d3060,
          emissiveIntensity: 0.55,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide
        })
        const decor = new THREE.Mesh(geo, mat)
        decor.rotation.x = -Math.PI / 2
        decor.position.y = BOARD_Y + 0.025
        scene.add(decor)
        cellMeshes.set(posKey({ ring, seg }), decor)

        const hitMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0
        })
        const hit = new THREE.Mesh(geo.clone(), hitMat)
        hit.rotation.x = -Math.PI / 2
        hit.position.y = BOARD_Y + 0.06
        hit.userData = { kind: 'cell', ring, seg }
        scene.add(hit)
        cellHitMeshes.push(hit)
      }
    }

    // Cell outlines (a wireframe-y look)
    const outlineMat = new THREE.LineBasicMaterial({
      color: 0x4cd0ff,
      transparent: true,
      opacity: 0.55
    })
    for (const ring of [0, 1] as const) {
      for (let seg = 0; seg < 12; seg++) {
        const shape = segmentShape(ring, seg, 0.02)
        const pts = shape.getPoints(40).map((p) => new THREE.Vector3(p.x, BOARD_Y + 0.03, p.y))
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
        const line = new THREE.LineLoop(lineGeo, outlineMat)
        scene.add(line)
      }
    }

    // ---- pieces group ------------------------------------------------------
    const pieceGroup = new THREE.Group()
    scene.add(pieceGroup)
    const pieceMeshes = new Map<string, THREE.Group>()
    const pieceTargets = new Map<string, THREE.Vector3>()
    const pieceFades = new Map<string, number>()

    sceneRefs.current = {
      scene,
      pieceGroup,
      cellMeshes,
      cellHitMeshes,
      pieceMeshes,
      pieceTargets,
      pieceFades
    }

    // First sync (after the refs are populated)
    syncScene()

    // ---- picking -----------------------------------------------------------
    const raycaster = new THREE.Raycaster()
    const ptr = new THREE.Vector2()
    const dom = renderer.domElement
    dom.style.cursor = 'grab'

    function pick(e: PointerEvent): void {
      const rect = dom.getBoundingClientRect()
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ptr, camera)
      // Pieces first (taller, more salient)
      const pieceHits = raycaster.intersectObjects(pieceGroup.children, true)
      if (pieceHits.length > 0) {
        let g: THREE.Object3D | null = pieceHits[0].object
        while (g && !g.userData?.pieceId) g = g.parent
        const id = g?.userData?.pieceId as string | undefined
        if (id) {
          onClickRef.current({ kind: 'piece', pieceId: id })
          return
        }
      }
      // Then cells
      const cellHits = raycaster.intersectObjects(cellHitMeshes, false)
      if (cellHits.length > 0) {
        const ud = cellHits[0].object.userData
        onClickRef.current({
          kind: 'cell',
          pos: { ring: ud.ring as 0 | 1, seg: ud.seg as number }
        })
        return
      }
      onClickRef.current({ kind: 'empty' })
    }

    // Treat a small drag as a click but a longer drag as a camera move.
    let downAt: { x: number; y: number; t: number } | null = null
    function onDown(e: PointerEvent): void {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
    }
    function onUp(e: PointerEvent): void {
      if (!downAt) return
      const dx = e.clientX - downAt.x
      const dy = e.clientY - downAt.y
      const dt = performance.now() - downAt.t
      downAt = null
      if (dx * dx + dy * dy < 16 && dt < 350) pick(e)
    }
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointerup', onUp)

    // ---- resize ------------------------------------------------------------
    function resize(): void {
      const w = mount!.clientWidth
      const h = mount!.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    // ---- animation loop ----------------------------------------------------
    let raf = 0
    const tmp = new THREE.Vector3()
    function animate(): void {
      raf = requestAnimationFrame(animate)
      const t = performance.now() / 1000

      // smooth-move pieces toward their target & hover bob
      const refs = sceneRefs.current
      if (refs) {
        for (const [id, group] of refs.pieceMeshes) {
          const target = refs.pieceTargets.get(id)
          if (target) {
            tmp.copy(target)
            // bob: +/- 0.07 over ~1.8s, phase-shifted by id hash
            const phase = (id.charCodeAt(1) || 0) * 0.7
            tmp.y += 0.07 * Math.sin(t * 2.2 + phase) + 0.0
            group.position.lerp(tmp, 0.18)
          }
          // fading captured pieces
          const fade = refs.pieceFades.get(id)
          if (fade != null) {
            const next = fade - 0.04
            if (next <= 0) {
              refs.pieceGroup.remove(group)
              refs.pieceMeshes.delete(id)
              refs.pieceFades.delete(id)
              refs.pieceTargets.delete(id)
            } else {
              refs.pieceFades.set(id, next)
              group.scale.setScalar(0.6 + next * 0.4)
              group.traverse((o) => {
                const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
                if (m && 'opacity' in m) m.opacity = Math.min(0.9, next)
              })
            }
          }
        }
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointerup', onUp)
      controls.dispose()
      renderer.dispose()
      if (dom.parentNode) dom.parentNode.removeChild(dom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-sync the scene whenever game state or selection changes.
  useEffect(() => {
    syncScene()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedId])

  function syncScene(): void {
    const refs = sceneRefs.current
    if (!refs) return
    const { pieceGroup, cellMeshes, pieceMeshes, pieceTargets, pieceFades } = refs
    const s = stateRef.current

    // ---- piece reconciliation -------------------------------------------
    const liveIds = new Set(s.pieces.map((p) => p.id))
    // Add new piece meshes
    for (const p of s.pieces) {
      if (!pieceMeshes.has(p.id)) {
        const g = buildPieceMesh(p.type, p.team)
        g.userData = { pieceId: p.id }
        // tag every child so picking finds the parent
        g.traverse((o) => {
          o.userData = { ...(o.userData || {}), pieceId: p.id }
        })
        pieceMeshes.set(p.id, g)
        pieceGroup.add(g)
        // Spawn at target (no animation on first appearance)
        const tgt = cellCentre(p.pos.ring as 0 | 1, p.pos.seg)
        g.position.copy(tgt)
        pieceTargets.set(p.id, tgt)
      } else {
        pieceTargets.set(p.id, cellCentre(p.pos.ring as 0 | 1, p.pos.seg))
      }
    }
    // Fade out removed pieces (captured)
    for (const [id] of pieceMeshes) {
      if (!liveIds.has(id) && !pieceFades.has(id)) {
        pieceFades.set(id, 1.0)
      }
    }

    // ---- selection & highlight ------------------------------------------
    const selPiece: Piece | null = selectedRef.current
      ? pieceById(s, selectedRef.current)
      : null

    // Reset all cells & piece glows to baseline
    for (const [, m] of cellMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.color.set(0x0d2740)
      mat.emissive.set(0x0d3060)
      mat.emissiveIntensity = 0.55
      mat.opacity = 0.72
    }
    for (const [id, g] of pieceMeshes) {
      const isSel = selPiece && id === selPiece.id
      setPieceGlow(g, isSel ? 2.0 : 1.1)
    }

    // Selected piece's legal destinations & attack targets
    if (selPiece) {
      for (const m of legalMoves(s, selPiece)) {
        const cell = cellMeshes.get(posKey(m))
        if (cell) {
          const mat = cell.material as THREE.MeshStandardMaterial
          mat.color.set(0x0f4830)
          mat.emissive.set(0x1ec97a)
          mat.emissiveIntensity = 1.4
          mat.opacity = 0.85
        }
      }
      for (const a of legalAttacks(s, selPiece)) {
        const cell = cellMeshes.get(posKey(a))
        if (cell) {
          const mat = cell.material as THREE.MeshStandardMaterial
          mat.color.set(0x501620)
          mat.emissive.set(0xff4060)
          mat.emissiveIntensity = 1.7
          mat.opacity = 0.9
        }
      }
      // Highlight the cell the selected piece is on (gold-ish)
      const ownCell = cellMeshes.get(posKey(selPiece.pos))
      if (ownCell) {
        const mat = ownCell.material as THREE.MeshStandardMaterial
        mat.color.set(0x3a2a08)
        mat.emissive.set(0xffc34a)
        mat.emissiveIntensity = 1.5
        mat.opacity = 0.9
      }
    }

    // Highlight chain-piece if a chain is live (so the player notices)
    if (s.chainPieceId) {
      const cg = pieceMeshes.get(s.chainPieceId)
      if (cg) setPieceGlow(cg, 2.4)
    }
  }

  const styleHint = useMemo(
    () =>
      ({
        position: 'absolute',
        inset: 0
      }) as React.CSSProperties,
    []
  )

  return <div ref={mountRef} style={styleHint} />
}

export default Board3D
