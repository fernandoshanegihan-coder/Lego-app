---
doc: spec
status: approved
---

> Visual companion: `devpost/spec.html`. **This Markdown file is the canonical document.**

# Brickbrain — Technical Spec

## How This Works, In Plain Language

Brickbrain is one web page with two halves. On the left, a 3D canvas. On the right, a chat panel.

Behind the page sits a small server — the same program, in a different folder — because two secrets live there
that the browser must never see: your Anthropic API key and your Rebrickable API key. When you add a set, the
server asks Rebrickable what parts are in it and hands the parts back to your browser. Your browser keeps them.
Nothing about you is stored on the server.

When you ask for ideas, your browser sends your parts list along with the message. The server reads it, and
starts a short conversation with Claude. That conversation has one unusual property: **Claude can run code
while it thinks.** It has three tools it can call mid-answer — fetch a set's parts, list your parts, and
`validate_build`, which checks a design against your actual pile.

That last tool is the whole product. Claude writes a design in grid coordinates, calls `validate_build`, and
gets back either *"fine"* or a list of specific complaints — *"brick 31, red 2×4, you use 4, you own 2."* Claude
reads that and edits its own design. It isn't being corrected by us; it's correcting itself, because the
violation came back as ordinary data rather than as an error. If it still can't get clean after three tries,
the server throws away the offending bricks and renders the rest — so the canvas **physically cannot** show a
brick you don't own.

The tools are served over **MCP** — the Model Context Protocol — rather than wired directly into the app. That
is a deliberate choice: MCP is the standard way to give a model callable tools, so the same tool code can be
driven by this app *and* by Claude Code later, with no rewrite. The tools themselves are plain functions; MCP
is only how they're exposed.

Why this shape rather than something more elaborate? Because the risky, expensive parts are Claude and the
3D, and everything else should be boring. There is no database, no login, no background job, and no queue. One
Next.js process, one in-memory MCP server per conversation, two outbound HTTPS calls.

## The Core Journey Through the System

`prd.md > The Core Journey`, traced through the pieces.

| PRD step | What happens | Lives in |
|---|---|---|
| **1. Arrive** | The page renders. `CollectionStore` reads `localStorage`; the canvas gets an empty brick list and shows the bare baseplate. The chat shows the static greeting — **no model call until the user speaks**. | `app/page.tsx`, `lib/storage.ts` |
| **2. Add a set** | `SetField` posts the number to `/api/sets`. The route asks Rebrickable, normalizes the parts, drops anything unrenderable, and returns a `StoredSet`. The browser merges it and writes `localStorage`. | `components/SetField.tsx` → `app/api/sets/route.ts` → `rebrickable/client.ts` → `parts/normalize.ts` |
| **3. Ask** | `ChatPanel` posts `{ messages, inventory }`. The route builds the system prompt, spins up an in-process MCP server bound to *this* inventory, lists its tools, and opens the agent loop. Claude calls `propose_ideas` with exactly three items; they stream back as `ideas` events. | `components/ChatPanel.tsx` → `app/api/chat/route.ts` → `lib/loop.ts` |
| **4. Pick** | Clicking an `IdeaCard` sends its title as a normal user message. Nothing special happens — it is the same path as step 3. | `components/IdeaCard.tsx` |
| **5. Design** | Claude composes a design and calls `validate_build`. The MCP server runs the pure validator and returns `{ ok: false, violations }`. Claude edits and calls again. When it passes — or after six turns — the `build` event goes to the browser. | `mcp/tools.ts` → `validate/validateBuild.ts` → `lib/loop.ts` |
| **6. See it** | `BuildCanvas` sorts the bricks by `y` and reveals them on a 25ms interval. `KernelStrip` shows `used / available`. | `components/BuildCanvas.tsx`, `scene/brickGeometry.ts` |
| **7. Refine** | The same path as step 3. History carries the previous design, so "make it taller" has something to modify. Revalidation is automatic — every design passes through `validate_build`. | `lib/loop.ts` |
| **8. Success** | The strip is green, the counter reconciles against the pool, and every brick on screen maps to a part in `localStorage`. | `components/KernelStrip.tsx` |

## The Stack

| Piece | Choice | Why |
|---|---|---|
| Framework | **[Next.js](https://nextjs.org/docs)** (App Router), TypeScript | One process, one command, one port. API routes hold the secrets; React renders the page. |
| UI | **[React](https://react.dev)** + **[Tailwind CSS](https://tailwindcss.com/docs)** | Tailwind's arbitrary values map the PRD palette straight into classes with no config sprawl. |
| 3D | **[three.js](https://threejs.org/docs/)** via **[@react-three/fiber](https://r3f.docs.pmnd.rs/)** + **[@react-three/drei](https://drei.docs.pmnd.rs/)** | The build is a list; the scene is a `.map()` over it. Layer-by-layer reveal is a slice, not an animation engine. drei gives `OrbitControls` and environment lighting in one line. |
| Model access | **[@anthropic-ai/sdk](https://docs.anthropic.com/en/api/client-sdks)** | Official SDK, streaming, and the MCP bridge helpers. |
| Tools transport | **[@modelcontextprotocol/sdk](https://modelcontextprotocol.io/docs)** | Real MCP over `InMemoryTransport`, so tool definitions come *from the MCP server* rather than being hand-written twice. |
| Validation | **[zod](https://zod.dev)** | The model's output is untrusted input. Schemas catch malformed designs at the boundary instead of as a blank canvas. |
| Tests | **[Vitest](https://vitest.dev)** | Fast, zero-config with TypeScript, and the validator is pure functions. |

**Tradeoff accepted:** Next.js is a lot of framework for one page. In exchange, there is no second server, no
CORS, and no proxy — and the route handler is a single file that owns every secret. The alternative (Vite +
separate Express) is more explicit and roughly a day more setup for the same result.

**Unverified at spec time, check first thing in the build:**

1. The exact **model ID** — set once in `lib/anthropic.ts`, confirmed against Anthropic's model list.
2. The **MCP helper import paths** in the SDK (`mcpTools` / `toolRunner` live under a beta namespace). The
   design does **not depend** on them; see *The agent loop* below.
3. **Rebrickable part-category IDs** — fetched at runtime, not hardcoded.
4. Whether streaming composes cleanly with tool calls. Fallback is non-streaming with a typing indicator.

## Where It Runs and How Someone Tries It

**Local only. No deployment.** Submission requires a demo video and a public GitHub repository; neither is
replaced by hosting. The API keys therefore stay on one machine, which removes a whole class of problems.

**Requirements:** Node 20+, npm, a free Rebrickable account (API key), an Anthropic API key.

**Start:**

```bash
npm install
cp .env.example .env.local     # then fill in the two keys
npm run dev
```

Open **http://localhost:3000**.

**Record the demo from that.** No build step, no Docker, no database to start.

**`.env.local`:**

```
ANTHROPIC_API_KEY=sk-ant-...
REBRICKABLE_API_KEY=...
```

Both are read only in server code. Neither is ever sent to the browser.

## Look and Feel

Carried forward from `prd.md > Look and Feel` and `scope.md > Inspiration & Identity`.

**"The workbench in daylight."** Warm off-white, and LEGO colours doing all the work.

| Role | Value |
|---|---|
| Bench | `#f5f1e8` |
| Canvas surface | `#ebe5d8` |
| Raised panel | `#fbf9f4` |
| Edge | `#e2dccf` |
| Ink / dim | `#2a2620` / `#7a7263` |
| Accent | `#ffd814` (graphic only) |
| Verified | `#1c7a45` on `#e4f3ea` |
| Violation | `#a81f16` on `#fbe9e7` |

- **Type:** Space Grotesk for UI; JetBrains Mono for part numbers and the brick counter.
- **Chat:** plain text blocks, no bubbles. User messages get a 3px yellow left-bar.
- **Density:** spacious and calm. The canvas gets the space; the chat panel is a fixed ~360px column.
- **Tone of copy:** plain, specific, never chirpy. "You own 2 of these." Not "Oops! Looks like you're short ✨".

**3D direction.** This is where the reference image matters. Bricks are **real geometry**, not boxes:

- Beveled body — a 0.3mm chamfer on the top edges so light catches the silhouette.
- Cylindrical studs on top: radius 0.24 studs, height 0.09 of a brick, 12 segments.
- Slopes get a genuine angled top face.
- Materials are `MeshStandardMaterial` with roughness ~0.35 and low metalness — ABS plastic is slightly glossy,
  not mirror.
- Lighting: one key directional light from upper-left, a soft fill, and an environment map from drei's
  `Environment preset="studio"` for the ambient bounce. Slight contact shadow under the model.
- Camera: perspective, ~35° elevation, orbit constrained so the user can't go under the baseplate.

The camera does **not** auto-rotate. The user orbits.

## Components

### `CollectionStore` — the browser's memory

`lib/storage.ts` and `lib/collection.ts`.

Holds the user's sets and the flattened parts pool. Reads from and writes to `localStorage` under
`brickbrain.collection.v1`. This is the **only** place the collection exists persistently.

The pool is derived, not stored twice: `aggregate(sets) → Map<"partNum:colorId", { ...part, quantity }>`.
Aggregation is what makes two sets of the same colour combine into a usable quantity.

PRD ref: `prd.md > The collection`, `prd.md > Adding a set`.

### `SetField` and `CollectionSummary` — the toolbar

`components/SetField.tsx`, `components/CollectionSummary.tsx`.

The dedicated set field. On submit it posts to `/api/sets`, shows a spinner, then either:

- **success** — the field is replaced by `21328 — Lego Ideas (1,234 parts · 612 buildable)`, and the entry is
  merged into the collection;
- **failure** — an inline red line under the input, the typed text preserved, the collection untouched.

Duplicate set numbers are rejected client-side before the request.

PRD ref: `prd.md > Adding a set`, `prd.md > States and Boundaries`.

### `ChatPanel` — the conversation

`components/ChatPanel.tsx`, `components/MessageList.tsx`, `components/IdeaCard.tsx`.

Posts `{ messages, inventory }` to `/api/chat` and renders the streamed response. Three event types come back:

| Event | Rendered as |
|---|---|
| `text` | a streaming text block |
| `ideas` | three clickable `IdeaCard` rows |
| `build` | bricks handed to the canvas, counter updated |
| `kernel` | a violation or a clear pass, shown in the strip |
| `error` | a plain error line in the chat |

Clicking an `IdeaCard` sends that idea's title back as a normal user message.

PRD ref: `prd.md > Asking for ideas`, `prd.md > Refining`.

### `BuildCanvas` — the 3D view

`components/BuildCanvas.tsx`, `scene/Scene.tsx`, `scene/BrickMesh.tsx`, `scene/brickGeometry.ts`.

Renders the current build. Bricks arrive sorted by `y`, and the component reveals them at ~25ms intervals so
the model assembles bottom-up. `brickGeometry.ts` is the piece that makes this look real:

```
brick(p: PartShape) → BufferGeometry
  body   : rounded-edge box, w × (h/3) × d in stud units
  studs  : instanced cylinders, one per stud on the top face
  slope  : body with the top face replaced by an angled quad
```

Geometries are built once per distinct part shape and cached in a module-level `Map`; there are only a few
dozen, and rebuilding them per brick would tank the frame rate at 200 bricks.

PRD ref: `prd.md > Designing in 3D`.

### `KernelStrip` — the visible guarantee

`components/KernelStrip.tsx`.

A bar along the canvas floor. Two states:

- **verified** — green dot, *"every brick verified against your inventory"*, `47 / 612` in mono.
- **violation** — red bar, the specific complaint, and how many were found: *"red 2×4 — design uses 4, you own
  2. (3 problems)"*. Returns to green when the next `validate_build` passes.

The second number is the **buildable** count, with a `title` tooltip explaining that it excludes parts the
renderer can't draw.

PRD ref: `prd.md > The inventory guarantee (the kernel)`.

### `validateBuild` — the kernel's enforcer

`validate/validateBuild.ts`. A pure function, no I/O, no Anthropic. This is the most important file in the repo
and the only one with real test coverage.

**The occupancy model.** Every brick occupies a box on an integer grid measured in **studs × plates**:
`x` and `z` in studs, `y` in plates. A plate is 1; a brick is 3. A brick's footprint is `w × d` studs, rotated
by `rot ∈ {0,90,180,270}` (which swaps `w` and `d` at 90° and 270°).

Validation runs these checks, in order, over the whole build:

1. **Known part** — every `partNum` is in the buildable catalogue.
2. **Known colour** — that part exists in that colour in the user's pool.
3. **Quantity** — count per `(partNum, colorId)` ≤ owned quantity.
4. **In bounds** — every occupied cell lies inside the baseplate bounds (48 × 48 studs, 64 plates tall).
5. **No overlap** — no two bricks occupy the same cell.
6. **Supported** — for `y > 0`, at least one cell directly beneath the footprint (`y - 1`) is occupied by a
   brick that is not a slope.
7. **Grounded** — bricks at `y === 0` are on the baseplate.

Returns `{ ok: true, used, available }` or `{ ok: false, violations: [...] }` where each violation names the
brick index, the rule, and a human sentence Claude can act on.

```ts
type Violation = {
  brickIndex: number
  rule: 'unknown-part' | 'unknown-colour' | 'quantity' | 'bounds' | 'overlap' | 'support'
  detail: string   // "red 2×4 — design uses 4, you own 2"
}
```

**The self-correction contract:** violations are **returned, not thrown**. A thrown error ends the agent loop; a
returned violation continues it. This distinction is the entire mechanism.

PRD ref: `prd.md > The inventory guarantee (the kernel)`.

### `mcp/tools.ts` — the tool surface, transport-agnostic

Four functions plus one, each `(args, ctx) => result`, where `ctx` carries the request's inventory. No MCP
imports in this file. The same functions are wrapped by both hosts.

| Tool | Input | Does |
|---|---|---|
| `get_set_parts` | `{ setNum }` | Fetches from Rebrickable, returns the set's buildable parts. Caller merges into the collection. |
| `list_my_parts` | `{}` | Returns the aggregated pool, compactly. |
| `validate_build` | `{ bricks }` | Runs `validateBuild`. The kernel. |
| `save_build` | `{ name, bricks }` | Records an accepted design and reports parts used. |
| **`propose_ideas`** | `{ ideas: [{title, description}] }` | Requires exactly three. Emits the clickable rows. |

`propose_ideas` is an addition to the scope's four tools. The PRD requires *"three clickable rows"*
(`prd.md > Asking for ideas`), and structured tool output is the only non-fragile way to get them — parsing
markdown out of prose would break the first time Claude rephrases. Same reasoning as `validate_build`.

### `mcp/server.ts` and `mcp/stdio.ts` — two hosts, one core

`mcp/server.ts` builds an `McpServer` over an `InMemoryTransport` pair, bound to one request's inventory. The
chat route creates one per conversation and discards it. That is what keeps the server stateless: **no
collection is ever retained between requests.**

`mcp/stdio.ts` is a ~20-line adapter that serves the same `tools.ts` functions over stdio, taking the inventory
from a JSON file. It exists so the repo ships a *real* MCP server a judge can register with Claude Code. It is
not on the app's critical path.

Registered in `.mcp.json`:

```json
{ "mcpServers": { "brickbrain": { "command": "npx", "args": ["tsx", "mcp/stdio.ts"] } } }
```

### `app/api/chat/route.ts` — one request, one conversation

Node runtime. Per request:

1. Parse `{ messages, inventory }`; validate the inventory shape with zod.
2. Build the in-process MCP server for this inventory; connect a client.
3. `client.listTools()` → convert to Anthropic tool schemas. **The tool definitions come from the MCP server**,
   so there is exactly one description of each tool in the codebase.
4. Run the agent loop (below), streaming events back.
5. Close the client and server. Nothing survives the request.

### `app/api/sets/route.ts` — the toolbar's path

Takes `{ setNum }`, calls the same `rebrickable/client.ts` function the `get_set_parts` tool uses, and returns
normalized parts. Shares the implementation; does not go through MCP. Adding a set is a form submission, not a
conversation.

PRD ref: `prd.md > Adding a set`.

### The agent loop

`lib/loop.ts`. Hand-rolled rather than the SDK's `toolRunner`, for three reasons: streaming and tool use
compose awkwardly in beta helpers, the loop is ~40 lines, and making it explicit is the point of this project.

```
messages = [systemPrompt(inventory), ...history]

for turn in 1..6:
  response = anthropic.messages.stream({ model, system, messages, tools })

  for each content block:
    text        → emit `text` event
    tool_use    → record

  if response.stop_reason !== 'tool_use': break

  results = []
  for each tool_use:
    emit `kernel` if the tool is validate_build
    result = await mcpClient.callTool({ name, arguments })
    results.push({ type: 'tool_result', tool_use_id, content })

  messages += [assistantTurn, { role: 'user', content: results }]
```

The loop is transport-agnostic: it only ever calls `mcpClient.callTool`. Swapping the in-process server for a
stdio subprocess is a two-line change. That was the de-risking rule from `scope.md > Integration Mechanism`.

**The three-strike rule.** If turn 6 ends with `validate_build` still failing, the route drops the violating
bricks, renders what remains, and emits a `kernel` event saying how many were dropped. This is the layer that
makes the guarantee true even when the model fails.

### `lib/anthropic.ts` — the system prompt

Assembles the prompt. The inventory block is the load-bearing part:

```
You are designing LEGO builds for a user who owns exactly these parts and no others.

INVENTORY  (part | name | w×d×h | colour | qty)
3001  | Brick 2 x 4  | 4×2×3 | Red    | 6
3020  | Plate 2 x 4  | 4×2×1 | Yellow | 12
...

RULES
- Use only the parts, colours, and quantities above.
- Coordinates: x and z in studs, y in plates. A brick is 3 plates; a plate is 1.
- Call validate_build before returning any design. Fix what it reports.
- Aim for roughly 30–60 bricks for this pool.
```

A 1,200-part set yields ~150–250 distinct part/colour rows, roughly 3–4k tokens. Above that threshold the
prompt is capped to the highest-quantity rows and says so. Measured during the build.

### Model choice

One constant in `lib/anthropic.ts`. Default: the cheapest current Haiku-class model — this task is
constrained composition, not open-ended reasoning, and the validator catches what the model gets wrong. A
Haiku-class build costs a fraction of a cent; a Sonnet-class one costs ~20×. Switch by editing one line.

## Data Model

### In the browser (persisted)

`localStorage["brickbrain.collection.v1"]`:

```ts
type StoredSet = {
  setNum: string          // "21328-1"
  name: string            // "Lego Ideas"
  totalParts: number      // box count, shown in the field
  buildableParts: number  // renderable subset, shown in the kernel strip
  parts: StoredPart[]     // buildable parts only
  addedAt: number
}

type StoredPart = {
  partNum: string         // Rebrickable "3001"
  name: string            // "Brick 2 x 4"
  category: PartCategory  // 'brick' | 'plate' | 'tile' | 'slope'
  w: number; d: number    // studs
  h: number               // plates: 3 for a brick, 1 for a plate/tile
  colorId: number         // Rebrickable colour id
  colorName: string       // "Red"
  quantity: number
}
```

The **pool** is derived on every read: `aggregate(sets)` sums quantities by `(partNum, colorId)`.

### In memory only (lost on reload)

```ts
type PlacedBrick = {
  id: string
  partNum: string
  colorId: number
  colorName: string
  x: number; y: number; z: number   // studs, plates, studs
  rot: 0 | 90 | 180 | 270
}
```

Held in React state. Reloading gives an empty canvas, as recorded in `prd.md > States and Boundaries`.

### On the wire

`POST /api/sets` → `{ setNum }` → `{ set: StoredSet }` or `{ error }`.
`POST /api/chat` → `{ messages, inventory }` → text/event-stream.

The inventory is sent fresh on **every** chat request. The server holds none of it.

## File Structure

```
lego-app/
├── app/
│   ├── layout.tsx                 # fonts, page shell
│   ├── page.tsx                   # the one page: toolbar + canvas + chat
│   ├── globals.css                # palette as CSS variables, Tailwind layer
│   └── api/
│       ├── chat/route.ts          # agent loop; streams events
│       └── sets/route.ts          # Rebrickable fetch for the toolbar
│
├── components/
│   ├── Toolbar.tsx                # toolbar container
│   ├── SetField.tsx               # dedicated set number field + inline error
│   ├── CollectionSummary.tsx      # "3 sets · 1,904 parts"
│   ├── ChatPanel.tsx              # scroll area + input
│   ├── MessageList.tsx            # text blocks, user bars
│   ├── IdeaCard.tsx               # one clickable suggestion
│   ├── KernelStrip.tsx            # verified / violation states
│   └── BuildCanvas.tsx            # R3F <Canvas>, reveal timer
│
├── scene/
│   ├── Scene.tsx                  # lights, environment, OrbitControls, baseplate
│   ├── BrickMesh.tsx              # one brick: geometry + material + position
│   └── brickGeometry.ts           # procedural LEGO geometry, cached per shape
│
├── lib/
│   ├── types.ts                   # every shared type in this doc
│   ├── collection.ts              # aggregate(), add-set, duplicate detection
│   ├── storage.ts                 # localStorage read/write + version key
│   ├── anthropic.ts               # client, model constant, system prompt builder
│   ├── loop.ts                    # the agent loop + three-strike rule
│   └── sse.ts                     # event-stream encoding helper
│
├── mcp/
│   ├── tools.ts                   # the five tool functions — no MCP imports
│   ├── server.ts                  # McpServer over InMemoryTransport, per request
│   └── stdio.ts                   # stdio adapter for Claude Code
│
├── parts/
│   ├── normalize.ts               # Rebrickable part → StoredPart (name parsing, filtering)
│   ├── categories.ts              # category name → PartCategory allowlist
│   ├── colors.ts                  # Rebrickable colour id+name → hex
│   └── shapes.ts                  # PartShape catalogue the renderer can draw
│
├── rebrickable/
│   └── client.ts                  # the two GET calls, throttle, error mapping
│
├── validate/
│   ├── validateBuild.ts           # THE KERNEL — pure, no I/O
│   ├── validateBuild.test.ts      # one test per violation type
│   ├── normalize.test.ts          # part-name parsing, category filtering
│   └── grid.test.ts               # rotation, occupancy, support math
│
├── devpost/                       # scope.md, prd.md, spec.md (+ HTML companions)
├── .mcp.json                      # Claude Code registration for the stdio server
├── .env.example                   # the two key names, no values
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md                      # what it is, how to run, credits, disclaimer
```

## External Services and Dependencies

### Rebrickable

Docs: <https://rebrickable.com/api/v3/docs/>

Two calls, both `GET`, both with `Authorization: key <REBRICKABLE_API_KEY>`:

| Call | Purpose |
|---|---|
| `/api/v3/lego/sets/{set_num}/parts/?page_size=1000` | every part in the set, with `part.part_num`, `part.name`, `part.part_cat_id`, `color.id`, `color.name`, `quantity` |
| `/api/v3/lego/part_categories/` | id → name, cached in memory for the process |

**Rate limit ≈ 1 request/second.** One set is one (occasionally two) requests, so a throttle of 1.1s between
calls is enough. Fetched once per set added, never polled.

**Cost:** free, including commercial use. Requirement: credit Rebrickable as the data source — in the README
and on the page footer.

**Failure modes handled:** 404 (no such set) → inline error, "No set with that number." 401 → "Rebrickable
rejected the API key." 429 → single retry after 2s, then inline error.

### Anthropic

Docs: <https://docs.anthropic.com>

`POST /v1/messages`, streamed. Tools are passed as `tools: [...]` and results returned as `tool_result`
content blocks in a `user` turn.

**Cost:**, per token. A one-set design lands around $0.001 on a Haiku-class model; a five-set build with two
correction rounds, under $0.01. A full demo session is cents.

### Runtime dependencies, all free

Next.js, React, three.js, @react-three/fiber, @react-three/drei, @anthropic-ai/sdk,
@modelcontextprotocol/sdk, zod, tailwindcss, vitest, tsx.

## Important Failure Modes

- **Rebrickable returns a set with nothing renderable** (a Technic set, a minifig pack) → the field shows
  *"21328 loaded, but none of its 1,234 parts can be drawn."* The set is **not** added. Better than adding an
  empty shell the user can't use.
- **Claude never gets clean within six turns** → the three-strike rule drops the offending bricks, the model
  renders, and the kernel strip reads *"12 bricks dropped — they weren't in your collection."* The guarantee
  holds; the user sees an honest, slightly smaller build.
- **Malformed model output** (bad JSON, a coordinate that isn't an integer) → zod rejects it inside the tool
  call and the error is returned *as a tool result*, so Claude retries with the schema spelled out. Only if it
  fails twice does the user see *"The model returned something I couldn't read. Try again."*
- **Anthropic unreachable or key rejected** → a single plain line in the chat. Canvas and collection untouched.
  The page never white-screens.
- **`localStorage` unavailable or full** (private mode, quota) → the app runs but the collection doesn't
  persist; a one-line notice appears once.

## What Was Simplified and Why

- **Procedural brick geometry** instead of the LDraw parts library — it makes the renderer's vocabulary and
  the validator's vocabulary the *same set*, so a part that can't be drawn can't enter the pool. The fuller
  version would need a ~100MB asset library, a Rebrickable→LDraw mapping table, and handling for parts with no
  model. That's a day minimum and it's the kind of integration that can silently eat two.
- **In-process MCP server** instead of a stdio subprocess on the request path — no process lifecycle, no
  cross-process context passing, same protocol. The stdio adapter still ships, for Claude Code.
- **Hand-rolled agent loop** instead of the SDK's `toolRunner` — explicit, streamable, and roughly 40 lines. The
  helper would hide the mechanism this project exists to demonstrate.
- **Browser `localStorage`** instead of a database — no accounts, no server-side user data, nothing to deploy.
  The fuller version would need auth, a schema, and per-user hosting cost.
- **Slopes support nothing.** A slope occupies its full bounding box and no brick may rest on its angled face.
  Real LEGO allows a stud on the tall edge; modelling that correctly would complicate the support rule for a
  rare case.
- **Non-streaming fallback** if streaming and tool calls fight. The demo would lose the typing effect, not the
  function.
- **Ideas capped at exactly three** — fewer is faster to read and to build.

## Verification

**Unit tests (Vitest), `npm test`.** The validator is the product's claim, so it gets the coverage:

- a valid small build passes and reports the right `used` count
- unknown part number → `unknown-part`
- colour the user doesn't own → `unknown-colour`
- over-quantity → `quantity`, with the right brick index and a readable detail
- floating brick → `support`
- brick on top of a slope → `support`
- two bricks in the same cell → `overlap`
- brick outside the baseplate → `bounds`
- rotation at 90° swaps the footprint and still validates
- a 3-plate brick on a 1-plate plate is supported; a 1-plate plate on nothing is not
- name parsing: `"Brick 2 x 4"` → 4×2, `"Plate 1 x 2"` → 2×1, `"Slope 45 2 x 2"` → 2×2
- category filtering: Technic, minifig, and printed parts are excluded from the buildable pool

**Manual (watching it run).** Everything that costs money or needs a GPU: the three ideas, the agent loop, the
correction round trip, layer-by-layer assembly, orbit, refine, the kernel strip's red→green transition. Verified
by running the app — which is also the video recording session.

**The self-correction check.** A test the build must pass: feed `validate_build` a deliberately over-quantity
design in a manual session, and confirm the transcript shows Claude receive the violation and call
`validate_build` a second time with a corrected design. That is the mechanism working end to end.

## Decisions and Open Issues

**Learner choices made in this stage:**

| Decision | Choice | Tradeoff accepted |
|---|---|---|
| Stack | Next.js + TypeScript + R3F + Tailwind | More framework than one page needs, in exchange for one process and one port. |
| Where it runs | Local only, no deployment | A judge cannot type in a set number without cloning; the video and repo carry the submission. |
| MCP shape | In-process for the app + stdio adapter over the same tools | No separate process on the request path; the Claude Code story still ships. |
| Rendering | Procedural geometry, not LDraw | No curved slopes, Technic, or printed parts — in exchange for a day of work instead of two risky ones. |
| Parts sidebar | **Not built** (default applied) | The kernel strip already states the tally. |
| Part counts | Two: box count in the field, buildable count in the strip | One number would be simpler and slightly dishonest. |
| Verification | Hard tests on the validator, manual elsewhere | No automated coverage of the 3D or the Claude calls. |

**Implementation details derived from those choices** (not learner decisions): the occupancy model, the
`propose_ideas` tool, the three-strike rule, the 48×48 baseplate bound, the six-turn loop cap, the
slopes-support-nothing rule, and the in-memory-per-request MCP server.

**The one useful unknown — the self-correction loop.** At the start of this stage the learner's stated goal was
to understand MCP, and the concrete uncertainty was *how* `validate_build` makes Claude fix its own design
rather than needing a retry mechanism bolted on afterwards. Clarified with the worked trace: the tool returns
`{ ok: false, violations: [...] }` as ordinary tool output, so the model reads it in the same turn and edits,
while a thrown error would have ended the loop. **Evidence the build must produce:** a recorded session where
Claude's second `validate_build` call passes after a first one failed — plus the over-quantity manual test in
*Verification*.

**Open, all low-impact and settleable during the build:**

- **Exact model ID** — confirm against Anthropic's model list on day one; one constant.
- **SDK helper import paths** — irrelevant if the hand-rolled loop holds, which is the plan.
- **Rebrickable category IDs** — fetched at runtime; verify the bricks/plates/tiles/slope allowlist covers a
  real set on day one.
- **Token ceiling for the inventory block** — measure with a five-set pool; cap and note it above ~4k tokens.
- **Does the current build survive a reload?** Still no (carried from `prd.md > Open Questions`).
- **Greeting wording and the three idea titles** — drafted in the build.
