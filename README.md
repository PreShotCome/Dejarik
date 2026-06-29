# Dejarik

A 3D animated Star Wars holochess game for the desktop — Electron + React +
TypeScript + Three.js. Same packaging and auto-update story as Theo Desktop.

## Stack

| Layer | Tech |
|---|---|
| Shell | Electron 34 |
| UI | React 18 + TypeScript |
| 3D | Three.js (procedural geometry, holographic shading) |
| Build | electron-vite (Vite under the hood) |
| Packaging | electron-builder → NSIS installer (`.exe`) |
| Target | Windows only (for now) |

## What's in it

- A circular 24-space board (outer + middle rings of 12 segments each; the
  inner circle is unusable, per Dejarik convention).
- Four piece types — **Scout, Brute, Guardian, Predator** — each with its own
  movement and attack rules:
  - **Scout** — moves up to 2 orthogonal spaces; attacks radially fore/aft;
    may both move AND attack on the same turn.
  - **Brute** — moves 1 space in any direction (incl. diagonal); attacks
    any neighbour. Must start in the middle ring.
  - **Guardian** — moves in an L (1 radial + 2 tangential); attacks 2 spaces
    left or right along the ring.
  - **Predator** — moves 1 radial OR 2 tangential, can hop over pieces;
    attacks in an L.
- Chain captures, the 1-piece-3-turn survivor clock, and the win-by-elimination
  rule.
- A heuristic AI opponent at three difficulties (easy / normal / hard).
- Holographic-styled board and procedurally-built creature pieces. Click your
  piece, then click a glowing tile to move or a red-lit enemy to attack.

## Layout

```
electron.vite.config.ts          # main / preload / renderer build config
electron-builder.yml             # Windows NSIS installer + GitHub publish
src/
  main/index.ts                  # Electron main process + settings IPC
  main/updater.ts                # electron-updater wiring
  preload/index.ts               # contextBridge surface (window.dejarik)
  renderer/
    index.html
    src/
      App.tsx                    # shell: sidebar + 3D stage + AI loop
      main.tsx
      styles.css
      game/                      # pure TS rules engine
        types.ts                 # GameState, Piece, Team, etc.
        board.ts                 # ring/segment maths, neighbours
        pieces.ts                # per-type move/attack generators
        engine.ts                # legal-action checks, doMove/doAttack
        ai.ts                    # heuristic plan-the-whole-turn AI
      scene/                     # Three.js scene
        geometry.ts              # board geometry helpers
        pieceMesh.ts             # procedural creature meshes
        Board3D.tsx              # renderer + picking + highlights
      env.d.ts
```

## Develop

```sh
npm install
npm run dev        # launches Electron with HMR
```

## Type-check

```sh
npm run typecheck
```

## Build the Windows installer

```sh
npm run build:win
```

Produces `dist/dejarik-<version>-setup.exe` (one-click off; lets the user pick
the install dir; creates a desktop shortcut).

> **Note:** the NSIS installer must be built **on Windows** (or with wine).
> `npm run build` (the renderer/main bundling step) is cross-platform; only the
> final `electron-builder --win` packaging needs Windows.

## Auto-update

Same pattern as Theo Desktop: a **public GitHub releases repo**
(`PreShotCome/dejarik-releases`) holds the build artifacts. Public repo means
no token is needed at runtime; only *publishing* a release needs a token.

### One-time setup

1. Create a **public** repo `dejarik-releases` under `PreShotCome` (empty is
   fine — it only holds release assets). If you use a different name, update it
   in `electron-builder.yml` (`publish.repo`).
2. Make a GitHub **personal access token** with write access to that repo
   (classic: `repo` scope; or fine-grained: Contents read/write on the
   releases repo).

### Cutting a release

```powershell
$env:GH_TOKEN = "<your token>"   # PowerShell; lets electron-builder upload
npm version patch                # bump version (updater compares versions)
npm run release                  # builds + uploads the installer to GitHub Releases
```

## Rules reference

Modelled after the rules summary you handed me, which itself is based on
[Wookieepedia's Dejarik entry](https://starwars.fandom.com/wiki/Dejarik). The
canonical piece names (Mantellian Savrip, Houjix, Kintan Strider, K'lor'slug,
Ghhhk, Grimtaash the Molator) inspired the four piece archetypes here; the
3D models are procedural stand-ins, not fan-art replicas.

## Security posture

`nodeIntegration: false`, `contextIsolation: true`. The renderer can only reach
the main process through the audited `window.dejarik` surface defined in
`src/preload/index.ts`.

## Roadmap

1. ✅ **Shell** — installable Windows app, Modern Glass UI, auto-update.
2. ✅ **Game** — full rules engine, AI opponent, click-to-play.
3. ✅ **3D scene** — procedural holographic board and pieces.
4. **Animations** — smoother lerp on moves, capture flicker effect.
5. **Real models** — swap procedural creatures for GLTF holomonsters.
6. **Local multiplayer** — hot-seat mode.
