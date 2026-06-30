import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GameState, Piece, PieceType, Pos, Team } from '../game/types'
import { posKey } from '../game/board'
import { legalAttacks, legalMoves, pieceById } from '../game/engine'
import {
  BOARD_Y,
  R_INNER,
  R_MIDDLE,
  R_OUTER,
  cellCentre,
  segmentShape
} from './geometry'
import { buildPieceMesh } from './pieceMesh'

export type ClickEvent =
  | { kind: 'piece'; pieceId: string }
  | { kind: 'cell'; pos: Pos }
  | { kind: 'empty' }

interface Props {
  state: GameState
  selectedId: string | null
  autoOrbit: boolean
  flicker: boolean
  onClick: (e: ClickEvent) => void
  onModelsReady?: () => void
}

// ---- holographic material (fresnel + scanline) -----------------------------
// We can't roll our own ShaderMaterial here: the GLB creature models are all
// SkinnedMeshes (rigged), and a vanilla ShaderMaterial has no bone-skinning
// code path — render the raw vertex buffer without skinning and the model
// ends up at random scale/position. Instead we extend MeshBasicMaterial
// (which has built-in skinning) via onBeforeCompile, injecting our holo
// effect right before the final colour assignment.

interface HoloUniforms {
  uTime: { value: number }
  uColor: { value: THREE.Color }
  uSel: { value: number }
  uFlicker: { value: number }
}

type HoloMat = THREE.MeshBasicMaterial & { holo: HoloUniforms }

function makeHoloMaterial(team: Team): HoloMat {
  const color = new THREE.Color(team === 'blue' ? 0x36c8ff : 0xff5e7a)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  }) as HoloMat
  mat.holo = {
    uTime: { value: 0 },
    uColor: { value: color },
    uSel: { value: 0 },
    uFlicker: { value: 1 }
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.holo.uTime
    shader.uniforms.uColor = mat.holo.uColor
    shader.uniforms.uSel = mat.holo.uSel
    shader.uniforms.uFlicker = mat.holo.uFlicker

    // Pipe world-space position, normal, and view direction from the vertex
    // stage to the fragment stage. Anchor the inject just after the
    // built-in <project_vertex> chunk so skinning has already moved the
    // vertex and `transformed`/`transformedNormal` are final.
    shader.vertexShader =
      'varying vec3 vN_holo;\nvarying vec3 vV_holo;\nvarying vec3 vW_holo;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        #include <project_vertex>
        vec4 wp_holo = modelMatrix * vec4(transformed, 1.0);
        vW_holo = wp_holo.xyz;
        #ifdef USE_INSTANCING
          vN_holo = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
        #else
          vN_holo = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vV_holo = normalize(cameraPosition - wp_holo.xyz);
        `
      )

    // Replace MeshBasicMaterial's diffuse output with the holo effect.
    // `<opaque_fragment>` is the chunk that writes the final colour in
    // three.js r170+; we override gl_FragColor right after it.
    const fragInject = `
        float fres_holo = pow(1.0 - abs(dot(normalize(vN_holo), normalize(vV_holo))), 2.3);
        float scan_holo = 0.5 + 0.5 * sin(vW_holo.y * 34.0 - uTime * 3.2);
        float band_holo = smoothstep(0.45, 1.0, scan_holo);
        float lum_holo = (0.16 + fres_holo * 1.3 + band_holo * 0.13) * uFlicker;
        float a_holo = clamp(0.14 + fres_holo * 0.95 + band_holo * 0.06, 0.0, 0.92) * (0.82 + uSel * 0.18);
        vec3 col_holo = uColor * (lum_holo + uSel * 0.55) + vec3(1.0) * fres_holo * 0.28 * (0.55 + uSel);
        gl_FragColor = vec4(col_holo, a_holo);
    `
    shader.fragmentShader =
      'uniform vec3 uColor;\nuniform float uTime;\nuniform float uSel;\nuniform float uFlicker;\n' +
      'varying vec3 vN_holo;\nvarying vec3 vV_holo;\nvarying vec3 vW_holo;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>\n${fragInject}`
      )
  }
  return mat
}


// ---- model presets ----------------------------------------------------------
// One GLB per piece type, plus a target on-board height and any axis fix-up.
// The loader normalises each model to MODEL_H[type] tall and re-centres it on
// the origin so dropping it at cellCentre() lands it standing on the board.

const MODEL_SRC: Record<PieceType, string> = {
  scout: 'models/scout.glb',
  brute: 'models/brute.glb',
  guardian: 'models/guardian.glb',
  predator: 'models/predator.glb'
}

// Target physical size on the board for each piece, in world units. Applied
// to the model's LONGEST dimension (not strictly height) so sideways-authored
// Sketchfab models still land at a sane size. Cells are ~1.5 wide; we keep
// pieces close to 1 unit so several can crowd a ring without clipping.
const MODEL_H: Record<PieceType, number> = {
  scout: 1.0,
  brute: 1.4,
  guardian: 1.2,
  predator: 1.3
}

const MODEL_ROT: Record<PieceType, { x: number; y: number; z: number }> = {
  scout: { x: Math.PI / 2, y: 0, z: 0 },
  brute: { x: 0, y: 0, z: 0 },
  guardian: { x: -Math.PI / 2, y: 0, z: 0 },
  predator: { x: Math.PI / 2, y: 0, z: 0 }
}

// ----------------------------------------------------------------------------

function Board3D({
  state,
  selectedId,
  autoOrbit,
  flicker,
  onClick,
  onModelsReady
}: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  // Latest values for the click handler / animation closures.
  const stateRef = useRef(state)
  const selectedRef = useRef(selectedId)
  const onClickRef = useRef(onClick)
  const flickerRef = useRef(flicker)
  const onReadyRef = useRef(onModelsReady)
  stateRef.current = state
  selectedRef.current = selectedId
  onClickRef.current = onClick
  flickerRef.current = flicker
  onReadyRef.current = onModelsReady

  // Mutable scene refs the effect below populates and the syncer reads.
  const sceneRefs = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    renderer: THREE.WebGLRenderer
    pieceGroup: THREE.Group
    highlightGroup: THREE.Group
    cellHitMeshes: THREE.Mesh[]
    pieceMeshes: Map<string, THREE.Group>
    pieceTargets: Map<string, THREE.Vector3>
    pieceFades: Map<string, number>
    pieceMats: Map<string, HoloMat>
    modelTemplates: Partial<Record<PieceType, THREE.Group>>
    modelsReady: boolean
  } | null>(null)

  // Build the scene once.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
    camera.position.set(0, 7.2, 9.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 600, false)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.6, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 6.5
    controls.maxDistance = 18
    controls.minPolarAngle = 0.25
    controls.maxPolarAngle = 1.42
    controls.autoRotate = autoOrbit
    controls.autoRotateSpeed = 0.5

    // ---- lighting (subtle — pieces are unlit/holo-shaded, but the board
    // base reacts to a single warm key + amber rim) -----------------------
    scene.add(new THREE.AmbientLight(0x4a2233, 0.7))
    const key = new THREE.DirectionalLight(0xffb27a, 0.45)
    key.position.set(4, 8, 3)
    scene.add(key)

    // ---- board ------------------------------------------------------------
    buildBoard(scene)

    // ---- clickable cell tiles --------------------------------------------
    const cellHitMeshes: THREE.Mesh[] = []
    for (const ring of [0, 1] as const) {
      for (let seg = 0; seg < 12; seg++) {
        const shape = segmentShape(ring, seg)
        const geo = new THREE.ShapeGeometry(shape, 6)
        const hitMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0
        })
        const hit = new THREE.Mesh(geo, hitMat)
        hit.rotation.x = -Math.PI / 2
        hit.position.y = BOARD_Y + 0.04
        hit.userData = { kind: 'cell', ring, seg }
        scene.add(hit)
        cellHitMeshes.push(hit)
      }
    }

    // ---- piece + highlight groups ---------------------------------------
    const pieceGroup = new THREE.Group()
    scene.add(pieceGroup)
    const highlightGroup = new THREE.Group()
    scene.add(highlightGroup)

    sceneRefs.current = {
      scene,
      camera,
      controls,
      renderer,
      pieceGroup,
      highlightGroup,
      cellHitMeshes,
      pieceMeshes: new Map(),
      pieceTargets: new Map(),
      pieceFades: new Map(),
      pieceMats: new Map(),
      modelTemplates: {},
      modelsReady: false
    }

    // ---- load GLB models in parallel; sync once each lands ---------------
    const loader = new GLTFLoader()
    const types = Object.keys(MODEL_SRC) as PieceType[]
    let pending = types.length
    for (const type of types) {
      loader.load(
        MODEL_SRC[type],
        (gltf) => {
          try {
            const root = gltf.scene
            // Strip cameras, lights, and helpers — Sketchfab GLBs often ship
            // with these and they inflate Box3.setFromObject, which would
            // make our height-normalised scale come out tiny.
            const toRemove: THREE.Object3D[] = []
            root.traverse((o) => {
              const m = o as THREE.Mesh
              if (
                (o as THREE.Camera).isCamera ||
                (o as THREE.Light).isLight ||
                ((o as THREE.LineSegments).isLineSegments && !m.isMesh) ||
                (o as THREE.AxesHelper).type === 'AxesHelper'
              ) {
                toRemove.push(o)
              }
            })
            for (const o of toRemove) o.parent?.remove(o)

            const rr = MODEL_ROT[type]
            root.rotation.set(rr.x, rr.y, rr.z)
            root.updateMatrixWorld(true)

            // Bounds from MESHES only (ignore empty groups whose transforms
            // can still contribute weird offsets to a naive Box3).
            const measure = (): THREE.Box3 => {
              const b = new THREE.Box3()
              b.makeEmpty()
              root.traverse((o) => {
                const m = o as THREE.Mesh
                if (m.isMesh && m.geometry) {
                  m.geometry.computeBoundingBox?.()
                  if (m.geometry.boundingBox) {
                    const local = m.geometry.boundingBox.clone()
                    local.applyMatrix4(m.matrixWorld)
                    b.union(local)
                  }
                }
              })
              return b
            }

            let box = measure()
            const size = box.getSize(new THREE.Vector3())
            // Sanity floor: if a model came in degenerate (size 0), keep
            // scale 1 instead of dividing by zero and producing infinity.
            const longest = Math.max(size.x, size.y, size.z) || 1
            // Use the model's longest dimension as the basis. Some sketchfab
            // models are sideways (length > height); MODEL_H tunes the
            // *physical* size we want on the board, regardless of axis.
            root.scale.setScalar(MODEL_H[type] / longest)
            root.updateMatrixWorld(true)

            box = measure()
            root.position.set(
              -(box.min.x + box.max.x) / 2,
              -box.min.y,
              -(box.min.z + box.max.z) / 2
            )
            const wrap = new THREE.Group()
            wrap.add(root)
            const refs = sceneRefs.current
            if (refs) refs.modelTemplates[type] = wrap
            console.log(
              `[dejarik] model ready: ${type}`,
              `raw=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`,
              `scaled→${MODEL_H[type]} on longest axis`
            )
          } catch (e) {
            console.warn('[dejarik] model normalise failed', type, e)
          }
          if (--pending <= 0) {
            const refs = sceneRefs.current
            if (refs) {
              refs.modelsReady = true
              // Rebuild any procedural placeholders with real models.
              rebuildAllPieces()
              onReadyRef.current?.()
            }
          }
        },
        undefined,
        (err) => {
          console.warn('[dejarik] model load failed', type, err)
          if (--pending <= 0) {
            const refs = sceneRefs.current
            if (refs) {
              refs.modelsReady = true
              onReadyRef.current?.()
            }
          }
        }
      )
    }

    // Initial sync (uses procedural fallback until models land).
    syncScene()

    // ---- picking ----------------------------------------------------------
    const raycaster = new THREE.Raycaster()
    const ptr = new THREE.Vector2()
    const dom = renderer.domElement
    dom.style.cursor = 'grab'

    function pick(e: PointerEvent): void {
      const rect = dom.getBoundingClientRect()
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ptr, camera)
      // Highlight tiles take priority when a piece is selected — that's how
      // you commit a move.
      if (selectedRef.current) {
        const tileHits = raycaster.intersectObjects(highlightGroup.children, true)
        const tile = tileHits.find((h) => h.object.userData?.move)
        if (tile) {
          const m = tile.object.userData.move as Pos
          onClickRef.current({ kind: 'cell', pos: m })
          return
        }
      }
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
      // Then plain cells (deselect or attempt a long-move click).
      const cellHits = raycaster.intersectObjects(cellHitMeshes, false)
      if (cellHits.length > 0) {
        const ud = cellHits[0].object.userData
        onClickRef.current({ kind: 'cell', pos: { ring: ud.ring as 0 | 1, seg: ud.seg as number } })
        return
      }
      onClickRef.current({ kind: 'empty' })
    }

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

    // ---- resize -----------------------------------------------------------
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

    // ---- animation loop --------------------------------------------------
    let raf = 0
    const clock = new THREE.Clock()
    const tmp = new THREE.Vector3()
    function animate(): void {
      raf = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()
      const refs = sceneRefs.current
      if (refs) {
        // Holo flicker: subtle pulse plus rare deep dips.
        const fl = flickerRef.current
          ? 0.86 + 0.14 * Math.sin(t * 6.5) + (Math.sin(t * 47.0) > 0.93 ? -0.22 : 0)
          : 1
        for (const [, mat] of refs.pieceMats) {
          mat.holo.uTime.value = t
          mat.holo.uFlicker.value = fl
        }
        // Smooth piece movement + hover bob.
        for (const [id, group] of refs.pieceMeshes) {
          const target = refs.pieceTargets.get(id)
          if (target) {
            tmp.copy(target)
            const phase = (group.userData.phase as number) || 0
            const bob = 0.07 * Math.sin(t * 1.6 + phase)
            group.position.x += (tmp.x - group.position.x) * 0.18
            group.position.z += (tmp.z - group.position.z) * 0.18
            group.position.y = bob
          }
          const fade = refs.pieceFades.get(id)
          if (fade != null) {
            const next = fade - 0.04
            if (next <= 0) {
              refs.pieceGroup.remove(group)
              disposeGroup(group, refs.pieceMats, id)
              refs.pieceMeshes.delete(id)
              refs.pieceFades.delete(id)
              refs.pieceTargets.delete(id)
            } else {
              refs.pieceFades.set(id, next)
              group.scale.setScalar(0.6 + next * 0.4)
              const mat = refs.pieceMats.get(id)
              if (mat) mat.holo.uFlicker.value = next
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

  // Re-sync on game state / selection changes.
  useEffect(() => {
    syncScene()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedId])

  // Toggle auto-orbit on controls.
  useEffect(() => {
    const refs = sceneRefs.current
    if (refs) refs.controls.autoRotate = autoOrbit
  }, [autoOrbit])

  // ---- piece factory: real model if loaded, procedural placeholder otherwise
  function buildPiece(type: PieceType, team: Team): { group: THREE.Group; mat: HoloMat } {
    const refs = sceneRefs.current
    const mat = makeHoloMaterial(team)
    const tpl = refs?.modelTemplates[type]
    if (tpl) {
      const g = tpl.clone(true)
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          ;(o as THREE.Mesh).material = mat
          ;(o as THREE.Mesh).frustumCulled = false
        }
      })
      return { group: g, mat }
    }
    // Procedural fallback (looks rough next to the real GLBs, but at least
    // something is on the board while they stream in).
    const g = buildPieceMesh(type, team)
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.material = mat
        m.frustumCulled = false
      }
    })
    return { group: g, mat }
  }

  function rebuildAllPieces(): void {
    const refs = sceneRefs.current
    if (!refs) return
    // Replace every existing mesh with its real-model counterpart.
    const s = stateRef.current
    for (const p of s.pieces) {
      const existing = refs.pieceMeshes.get(p.id)
      if (existing) {
        refs.pieceGroup.remove(existing)
        disposeGroup(existing, refs.pieceMats, p.id)
        refs.pieceMeshes.delete(p.id)
      }
    }
    syncScene()
  }

  function syncScene(): void {
    const refs = sceneRefs.current
    if (!refs) return
    const { pieceGroup, pieceMeshes, pieceTargets, pieceFades, pieceMats } = refs
    const s = stateRef.current

    const liveIds = new Set(s.pieces.map((p) => p.id))
    for (const p of s.pieces) {
      if (!pieceMeshes.has(p.id)) {
        const { group, mat } = buildPiece(p.type, p.team)
        group.userData = { pieceId: p.id, phase: Math.random() * 6.28 }
        group.traverse((o) => {
          o.userData = { ...(o.userData || {}), pieceId: p.id }
        })
        pieceMeshes.set(p.id, group)
        pieceMats.set(p.id, mat)
        pieceGroup.add(group)
        const tgt = cellCentre(p.pos.ring as 0 | 1, p.pos.seg, 0)
        group.position.set(tgt.x, 0, tgt.z)
        pieceTargets.set(p.id, tgt)
      } else {
        pieceTargets.set(p.id, cellCentre(p.pos.ring as 0 | 1, p.pos.seg, 0))
      }
    }
    for (const [id] of pieceMeshes) {
      if (!liveIds.has(id) && !pieceFades.has(id)) {
        pieceFades.set(id, 1.0)
      }
    }

    // Update selection uSel on materials.
    for (const [id, mat] of pieceMats) {
      mat.holo.uSel.value = id === selectedRef.current ? 1 : 0
    }

    // Build the highlight overlay fresh.
    refreshHighlights()
  }

  function refreshHighlights(): void {
    const refs = sceneRefs.current
    if (!refs) return
    const { highlightGroup } = refs
    while (highlightGroup.children.length) {
      const c = highlightGroup.children.pop() as THREE.Mesh
      ;(c.geometry as THREE.BufferGeometry)?.dispose?.()
      ;(c.material as THREE.Material)?.dispose?.()
    }
    const s = stateRef.current
    const sel: Piece | null = selectedRef.current ? pieceById(s, selectedRef.current) : null
    if (!sel || s.winner) return

    const col = sel.team === 'blue' ? 0x36c8ff : 0xff5e7a

    // Movable cells: a translucent tinted tile that's also pickable.
    for (const m of legalMoves(s, sel)) {
      const shape = segmentShape(m.ring as 0 | 1, m.seg)
      const geo = new THREE.ShapeGeometry(shape, 6)
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      const tile = new THREE.Mesh(geo, mat)
      tile.rotation.x = -Math.PI / 2
      tile.position.y = BOARD_Y + 0.05
      tile.userData = { move: m }
      highlightGroup.add(tile)
    }

    // Attack targets: a red torus around the enemy (or empty cell, if the
    // piece could attack-into-air but no enemy is there — engine filters this
    // for legalAttacks so we only get genuine enemy targets).
    for (const a of legalAttacks(s, sel)) {
      const cc = cellCentre(a.ring as 0 | 1, a.seg, 0)
      const geo = new THREE.TorusGeometry(0.72, 0.06, 8, 32)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff2436,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
      const ring = new THREE.Mesh(geo, mat)
      ring.rotation.x = Math.PI / 2
      ring.position.set(cc.x, BOARD_Y + 0.07, cc.z)
      // Mark this position as a move target too — clicking the ring commits
      // the attack action (the App treats it as a cell click).
      ring.userData = { move: a }
      highlightGroup.add(ring)
    }
  }

  return <div ref={mountRef} className="stage-mount" />
}

// ---- board chrome (amber rings, red emitter rim, segment spokes) -----------

function buildBoard(scene: THREE.Scene): void {
  // Pedestal
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(R_OUTER + 0.25, R_OUTER + 0.45, 0.14, 72),
    new THREE.MeshBasicMaterial({ color: 0x0c0810, transparent: true, opacity: 0.7 })
  )
  base.position.y = BOARD_Y - 0.09
  scene.add(base)

  // Three amber rings at inner / middle / outer radii.
  const mkRing = (r: number, op = 0.55, tubeWidth = 0.022) =>
    new THREE.Mesh(
      new THREE.TorusGeometry(r, tubeWidth, 8, 80),
      new THREE.MeshBasicMaterial({
        color: 0xffb02e,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
  for (const r of [R_INNER, R_MIDDLE, R_OUTER]) {
    const t = mkRing(r)
    t.rotation.x = Math.PI / 2
    t.position.y = BOARD_Y + 0.02
    scene.add(t)
  }

  // Red emitter glow around the outermost edge.
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(R_OUTER + 0.18, 0.06, 8, 90),
    new THREE.MeshBasicMaterial({
      color: 0xe01124,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  glow.rotation.x = Math.PI / 2
  glow.position.y = BOARD_Y
  scene.add(glow)

  // Twelve radial spokes at the segment boundaries.
  const SEG = (Math.PI * 2) / 12
  const midR = (R_INNER + R_OUTER) / 2
  const len = R_OUTER - R_INNER
  for (let s = 0; s < 12; s++) {
    const a = (s - 0.5) * SEG + Math.PI / 2
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.012, len),
      new THREE.MeshBasicMaterial({
        color: 0xffb02e,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    spoke.position.set(Math.cos(a) * midR, BOARD_Y + 0.015, Math.sin(a) * midR)
    spoke.rotation.y = Math.PI / 2 - a
    scene.add(spoke)
  }

  // The dead-zone disc — marks the unusable inner circle in red.
  const dz = new THREE.Mesh(
    new THREE.CircleGeometry(R_INNER - 0.05, 48),
    new THREE.MeshBasicMaterial({
      color: 0xe01124,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  dz.rotation.x = -Math.PI / 2
  dz.position.y = BOARD_Y + 0.015
  scene.add(dz)
}

function disposeGroup(g: THREE.Group, mats: Map<string, HoloMat>, id: string): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose?.()
  })
  const mat = mats.get(id)
  if (mat) {
    mat.dispose()
    mats.delete(id)
  }
}

export default Board3D
