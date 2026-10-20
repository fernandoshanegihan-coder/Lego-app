# Brickbrain

Type in the LEGO sets you own. Ask what you can build. Get a 3D model made of
**only the bricks you actually have** — every brick checked against your
collection before it reaches the screen.

The rule that makes it work is the **kernel**: a pure validator
(`validate/validateBuild.ts`) that takes the model's proposed brick list and
checks it against the user's own parts. It returns violations as *data*, not
exceptions, so the model reads them and fixes its own design. A part the
renderer cannot draw never enters the collection, so it can never be claimed.

---

## Run it

Requirements: **Node 20+**, a free Rebrickable account, a free Google AI
Studio key (no credit card).

```bash
npm install
cp .env.example .env.local     # then paste your two keys into .env.local
npm run dev                    # http://localhost:3000
```

### The two keys

| Variable | Where to get it | Free? |
|---|---|---|
| `REBRICKABLE_API_KEY` | [rebrickable.com/register](https://rebrickable.com/register/) → [rebrickable.com/api](https://rebrickable.com/api/) → *Generate API Token* | yes, unlimited for this use |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → *Create API key* | yes, no credit card |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) → *Create key* | optional — a **fallback** provider, see below |

`.env.local` is gitignored. Never commit a key.

### Try it

1. Add a set number in the toolbar (e.g. `21328`). The app fetches the set's
   parts from Rebrickable and keeps the ones it can draw.
2. Ask the chat: *"what can I build?"* — you get three ideas, each grounded in
   the parts you own.
3. Click one. The model designs it in grid coordinates, the kernel checks it,
   and the strip along the canvas floor turns red with the specific complaint
   if anything is wrong — then green when the design is legal.
4. Say *"make it taller"* to refine the design that's already on the canvas.

`?demo=1` renders a small legal build straight from your collection, without
waiting for the model.

---

## How it works

```
browser ──POST /api/chat──▶ Next.js route
                              │
                              ├─ in-process MCP server (one per request)
                              │    list_my_parts · get_set_parts · propose_ideas
                              │    validate_build · save_build
                              │
                              ├─ agent loop (hand-rolled, six turns)
                              │    model → tool call → tool result → model …
                              │
                              └─ the kernel (pure, no I/O)
                                   validate/validateBuild.ts
                                   7 rules on an integer grid
```

**Coordinates.** `x` and `z` are studs, `y` is *plates* (a brick is 3 plates,
a plate or tile is 1). A brick occupies `w × d` studs; `rot` 90°/270° swaps
`w`/`d`. The grid is 48 × 48 studs and 64 plates tall.

**The seven rules.** known part → known colour → quantity → in bounds → no
overlap → supported → grounded at `y = 0`. Slopes occupy their full box but
support nothing.

**Violations are returned, not thrown.** A thrown error ends the conversation; a
returned violation lets the model correct itself. If it never converges, the
**three-strike rule** drops the offending bricks (cascading, because removing
a support orphans what it carried) and renders what remains — still legal.

**The provider.** Google's Gemini free tier (`lib/gemini.ts`), with a model
chain and retry because the free tier congests: a 503 means "try the next
model", not "the app is broken". **OpenRouter is the fallback** — a second
provider (`lib/openrouter.ts`), used only when Gemini's whole chain is
exhausted, and only if `OPENROUTER_API_KEY` is set; without that key the app
behaves exactly as if it did not exist. The agent loop, the tools and the
validator are provider-independent: a provider is anything that can turn a
system prompt, a history and a tool list into text, tool calls and tool
results (`lib/provider.ts`).

---

## Connect it to Claude (claude.ai or Claude Code)

The same five tools ship as a **real MCP server**. Point a client at it and
Claude can read the user's parts, design a build, and — because the design is
checked by the same kernel — put it on the app's canvas.

**From claude.ai** — *Settings → Connectors → Add connector → Local command*:

| Field | Value |
|---|---|
| Name | `brickbrain` |
| Command | `npx` |
| Arguments | `tsx mcp/stdio.ts` |
| Environment | `BRICKBRAIN_APP_URL=http://localhost:3000` |

**From Claude Code** — `claude mcp add brickbrain -- npx tsx mcp/stdio.ts`
(or commit the `.mcp.json` in this repo).

Then, with the app running (`npm run dev`) and a set added:

> "I own set 21328. What can I build from it?"
> "Design me a small coffee shop from those parts."

Claude calls `get_build_brief` (the parts and the coordinate rules), designs in
grid coordinates, calls `validate_build` — the kernel, the same one the app
uses — fixes whatever it is told is wrong, and calls `save_build`. The design
lands on the canvas with the kernel strip green.

`npx tsx scripts/mcp-flow.ts` runs exactly that sequence as a script, if you
want to see the whole exchange without a Claude client in the loop.

---

## Project map

```
app/
  api/sets/route.ts     the toolbar's path: set number → parts
  api/chat/route.ts     one request, one conversation; streams SSE events
  page.tsx              the one page: toolbar + canvas + chat + kernel strip
components/             ChatPanel · MessageList · IdeaCard · KernelStrip · BuildCanvas
scene/                  brickGeometry (procedural LEGO) · BrickMesh · Scene
lib/                    provider (the contract) · gemini · openrouter · loop (agent loop) · sse · storage · collection · buildRules · localState
mcp/                    tools.ts (the six tools) · server.ts (in-process) · stdio.ts (for Claude Code)
parts/                  normalize (Rebrickable → buildable parts) · categories · shapes
rebrickable/            the HTTP client (throttled to ~1 req/s) and its error mapping
validate/               validateBuild.ts (THE KERNEL) · grid.ts · buildSchema.ts
scripts/                kernel-evidence.ts (recorded self-correction transcript) · gemini-probe.ts
devpost/                scope · prd · spec · checklist — the planning documents
```

### The tools (five, transport-agnostic)

| Tool | What it does |
|---|---|
| `list_my_parts` | the aggregated pool: part, name, w×d×h, colour id + name, quantity |
| `get_set_parts` | a set's buildable parts from Rebrickable |
| `get_build_brief` | the inventory **and** the coordinate rules, so any client can design legally |
| `propose_ideas` | exactly three ideas, grounded in the inventory |
| `validate_build` | **the kernel** — seven rules, violations as data |
| `save_build` | submits a verified design — to the canvas, and to the running app |

The same functions are served by the in-process server the app uses and by
`mcp/stdio.ts`, which a judge can register with Claude Code:

```json
{ "mcpServers": { "brickbrain": { "command": "npx", "args": ["tsx", "mcp/stdio.ts"] } } }
```

The stdio server takes the collection from a JSON file (the same shape the
browser stores in `localStorage`); point `BRICKBRAIN_INVENTORY` at it.

---

## Checks

```bash
npm test        # 43 tests — the kernel, the three-strike rule, storage, the loop
npx tsc --noEmit
npx tsx scripts/kernel-evidence.ts   # the recorded self-correction transcript
```

`scripts/kernel-evidence.ts` prints the two turns a model sees when it gets a
design wrong: the first `validate_build` returns `ok: false` with the specific
complaint, the second returns `ok: true` after the model's own edit.

---

## Credits and disclaimer

- **Part data by [Rebrickable](https://rebrickable.com/)** — set, part and
  colour data comes from the Rebrickable API. Their API is free, including
  commercial use; this project credits them as required.
- LEGO and LEGO bricks are trademarks of the LEGO Group, which does not
  sponsor or endorse this project. This is a fan-made prototype, not an
  official product.
- Not affiliated with Google or Anthropic. The model provider is Google's
  Gemini API on its free tier.
