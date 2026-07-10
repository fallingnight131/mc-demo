# Terraria 3D — Project Vision

## Goal

Transform the Minecraft-style demo into **a 3D version of Terraria**: a voxel game built around a **finite, hand-structured world** with deep vertical exploration, distinct biomes, and adventure-driven cave systems.

Core philosophy: **Trade infinite horizontal space for a deeper, taller, more structured world.**
Minecraft is about infinite wandering. Terraria is about one dense, meaningful world where every region has identity and purpose. This project follows Terraria's philosophy in 3D voxel form.

This is still a demo, not a full clone. Depth of world design > breadth of features.

---

## World Structure (The Big Picture)

### Finite World

* The world is a **bounded box**, not infinite chunks.
* Suggested demo scale: ~2000 × 2000 blocks horizontally, ~512 blocks vertically (tune for performance; the vertical axis matters more than the horizontal).
* Layout from center outward: **Continent → endless-looking Ocean → invisible Air Wall** (world border).
  * The ocean should visually fade into the horizon (fog / haze) so the border never feels like a wall, even though it is one.
  * The air wall blocks movement and block placement beyond the boundary.

### Vertical Layers (Terraria's signature)

From top to bottom, the world is divided into named layers, each with its own ambience, blocks, and dangers:

1. **Space / Sky (天空层)** — high altitude; thin clouds; home of **Floating Islands (天空岛)** with treasure structures.
2. **Surface (地表)** — mountains, rivers, forests, and all surface biomes. Day/night cycle matters here.
3. **Underground (地下层)** — dirt/stone transition zone just below the surface; shallow caves, roots, early ores.
4. **Cavern (洞穴层)** — the largest layer and the **heart of the game**. Vast interconnected cave networks, underground lakes, ore veins, crystal caves, abandoned mineshafts.
5. **Underworld / Hell (地狱)** — the deepest layer. Lava seas, ash and hellstone, obsidian towers/ruined structures. A visually distinct, hostile finale to digging down.

Background color / fog / ambient light should change as the player crosses layer boundaries, so depth is always *felt*.

---

## Terrain Generation (Structured, Not Random)

Generation must be **structured and rule-driven**, not pure noise:

1. **Continent shaping** — a large landmass with a coherent coastline, surrounded by ocean. Use a falloff map so land smoothly descends into beaches and sea.
2. **Macro terrain features**:
   * **Mountain ranges (山脉)** — ridged, continuous ranges (ridge noise / domain warping), not random bumps.
   * **Rivers (河流)** — carved from mountains toward the ocean, with valleys.
   * **Plains, hills, beaches** as connective tissue between features.
3. **Biome placement is positional, not random**:
   * **Spawn point at the continent's center** is always a safe **Forest** biome.
   * **Corruption / Crimson (腐化/血腥)** spawns *away* from spawn, as a spreading blight region with chasms plunging into the underground.
   * **Jungle (丛林)** occupies one side of the continent, dense and layered, with its own deep underground jungle caves.
   * **Snow / Desert** (optional, if time allows) fill other regions.
   * **Dungeon (地牢)** — a single large generated structure near one coast: multi-floor brick labyrinth with loot rooms.
   * **World Tree (世界树)** — one colossal tree landmark, hollow inside, climbable, with rooms/loot in the trunk and canopy.
   * **Floating Islands (天空岛)** — several islands generated in the sky layer, each with a small structure and treasure.
4. **Cave systems are the priority**:
   * Terraria's real adventure happens underground. Caves must be **generous, interconnected, and traversable**: winding tunnels, large caverns, vertical shafts, underground lakes/lava pools.
   * Use 3D noise + worm/tunnel carvers; ensure surface entrances exist so players naturally discover the underground.
   * Ore distribution by depth (e.g., copper/iron shallow → gold/gems in caverns → hellstone in the underworld).
5. **Deterministic seed** — same seed always produces the same world (essential for debugging a structured world).

---

## Required Features

### Carried over from the MC demo (keep stable)

* First-person camera, WASD movement, mouse look
* Block placement & destruction
* Basic inventory & hotbar
* Basic textures
* Stable gameplay (no crashes, acceptable FPS)

### New for Terraria 3D

* Finite world with ocean border + air wall
* Layered world generation (sky → surface → underground → cavern → hell)
* Structured continent: mountains, rivers, coastline
* Biomes: Forest (spawn), Jungle, Corruption *or* Crimson (pick one for the demo), Ocean
* Landmarks: World Tree, Floating Islands, Dungeon, Underworld structures
* Depth-based ambience: fog color, sky color, ambient light change with layer/biome
* Depth-based ore distribution
* Simple torches / light sources (caves are dark; light is a core Terraria loop)
* A **depth meter / mini HUD** showing current layer (strongly reinforces the Terraria feel)

### Explicit non-goals (for the demo)

* No bosses, NPCs, or combat systems (unless everything else is done)
* No multiplayer
* No world saving beyond a simple serialize (optional)
* No infinite chunk streaming — the world is finite by design

---

## Tech Stack

* TypeScript
* Three.js
* Vite

**Architecture: read and follow `ARCHITECTURE.md`.** It defines the layer model, the registries
(items/weapons, block-use, panels, save sections, flags), and per-content playbooks for adding
blocks / weapons / mobs / bosses / NPCs / UI. New systems must plug into those extension points
instead of growing `main.ts`; if the architecture doesn't fit, update `ARCHITECTURE.md` first,
then the code. Its §6 invariants (id space, save key, `__game` debug API, test import paths,
determinism, perf budget) must never be broken.

Performance notes for a finite-but-tall world:

* Chunked meshing with greedy meshing or face culling; only render chunks near the player.
* The world is finite, so chunk indexing can be a flat 3D grid — simpler and faster than hashmap-based infinite worlds.
* Generate the whole world's *data* at startup if memory allows (with a loading screen + progress bar), or lazily per column; meshing stays lazy either way.

---

## Working Style

* Work autonomously. Do not stop to ask questions.
* Fix errors automatically.
* Test changes when possible (at minimum: build passes, game loads, player can move/dig/place).
* Read and update `skills/progress.md` in every loop.
* Read and update `skills/memory.md` in every loop.
* When changing world generation, always regenerate with a fixed test seed and visually sanity-check the result (screenshot or fly-through if possible).
* When adding or modifying models, environments, terrains, landscapes, buildings, etc., take a snapshot of the new model and save it in the `shots/` folder. Verify that the model looks good and is suitable; if it is substandard or does not meet requirements, make the necessary adjustments to ensure the snapshot aligns with the specifications.
* After adding or modifying props or items, place the completed item icons into the "/items" folder; if an icon does not meet the requirements, modify it yourself to ensure compliance.
* Once existing goals have been achieved, reasonably set new ones to advance the project toward becoming a full 3D version of Terraria.
* Commit git in every loop with meaningful messages.

---

## Priorities

1. **Make it playable** — movement, digging, placing must always work.
2. **Make the world feel like Terraria** — layers, biomes, landmarks, caves. This is the soul of the project.
3. **Make it stable** — no crashes, world generation always completes.
4. **Make it look good** — layer-based ambience, distinct biome palettes.
5. **Optimize performance** — target 60 FPS on a mid-range machine.

---

## Milestones

Work through these phases in order. Each phase should end in a playable, committed state.

* **Phase 1 — Finite World Skeleton**: bounded world, continent + ocean + air wall, basic surface terrain with mountains, spawn at center. Playable on the surface.
* **Phase 2 — Vertical Layers & Caves**: full-depth world, underground/cavern/hell layers, cave carving, depth-based fog/light, torches, depth meter.
* **Phase 3 — Biomes**: Forest / Jungle / Corruption with distinct blocks, palettes, and terrain rules; rivers.
* **Phase 4 — Landmarks**: World Tree, Floating Islands, Dungeon, Underworld structures, depth-based ores and loot chests.
* **Phase 5 — Polish**: performance, visuals, ambience, bug-fixing, gameplay feel.
* **Phase 6 — New Objectives**: Defining and updating the main progression path through iterative cycles; expanding gameplay mechanics; steering the game toward becoming a full 3D version of *Terraria*.