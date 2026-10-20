---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast — chosen at first session (learner is agent-experienced and delegating mechanism calls; pauses at the two planned checkpoints).

## Slices

- [x] **1. You can type a set number and see the collection grow**
  Becomes usable: The page renders in the warm palette with all four regions (toolbar, canvas, chat, kernel
  strip) in place — canvas, chat, and strip are placeholders. Typing a real set number into the dedicated field
  fetches its parts from Rebrickable, filters to the buildable subset, and shows the confirmation
  `21328 — Lego Ideas (1,234 parts · 612 buildable)` plus a live collection summary. Nothing persists yet.
  Why now: Proves the riskiest external integration (Rebrickable's real data shape, part-name parsing, and the
  category allowlist) on the very first slice, with the whole page scaffolded underneath it — so every later
  slice lands on a page that already looks like the product. Bootstrapping (scaffold, deps, fonts, palette)
  lives here.
  PRD ref: `prd.md > Adding a set`, `prd.md > Screens and Layout`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Components > SetField and CollectionSummary`, `spec.md > External Services and
  Dependencies`, `spec.md > File Structure`, `spec.md > The Stack`
  Build: `create-next-app` scaffold per the file structure; types, palette CSS vars, fonts; `rebrickable/client.ts`
  (two GETs + throttle); `parts/normalize.ts` (name parsing, category allowlist, color mapping); `/api/sets`
  route; SetField with inline error + duplicate rejection; CollectionSummary. Requires `REBRICKABLE_API_KEY`
  in `.env.local`.
  Verify (mechanical): `POST /api/sets/` with real set `21328-1` via curl → JSON with >500 normalized buildable
  parts, correct name/counts; `POST` with `99999` → 404 error shape; dev server boots with zero console errors.
  Learner check: Put your Rebrickable key in `.env.local`, start the server, add a set you own, and confirm the
  field shows its name with two counts and the summary updates.
  Commit: `Set field fetches real set parts and fills the collection`

- [x] **2. The collection survives a reload**
  Becomes usable: Sets added before refresh are still there afterward — summary and counts intact. The only
  persistent user data in the entire system.
  Why now: Persistence is the first place the data model can be wrong, and finding that out now is cheap.
  PRD ref: `prd.md > The collection`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Data Model`, `spec.md > Components > CollectionStore`
  Build: `lib/storage.ts` (versioned key `brickbrain.collection.v1`, quota-error handling) and
  `lib/collection.ts` (`aggregate`, duplicate detection); write on add, load on mount.
  Verify (mechanical): Add two sets, reload the page, confirm both render the same summary; inspect
  localStorage for the versioned key with the buildable-only parts.
  Learner check: Add a set, refresh the page, and confirm the collection summary is unchanged.
  Commit: `Persist collection to localStorage`

- [x] **3. The kernel: a proposed build is accepted or rejected with named reasons**
  Becomes usable: As a library — not on screen yet — a proposed brick list is checked in seven ordered rules
  against the user's pool, and violations come back as data with brick index, rule, and a human sentence.
  Why now: This is the unique kernel, and the skill ordering rule says it lands early, not last. It is also the
  exception where a pure layer is its own slice: the validator independently proves the project's central risk
  (the occupancy model and the returned-violation contract) and leaves runnable evidence — a green test suite
  that later slices call.
  PRD ref: `prd.md > The inventory guarantee (the kernel)`
  Spec ref: `spec.md > Components > validateBuild`, `spec.md > Verification`
  Build: Pure `validate/validateBuild.ts` (integer grid: x/z studs, y plates; seven rules; violations not
  exceptions) plus `parts/shapes.ts` vocabulary and zod build schema; the full Vitest suite from the spec — one
  test per violation type, rotation math, name parsing, category filtering.
  Verify (mechanical): `npm test` green — the ~13 named cases pass, including over-quantity detail text,
  slope-supports-nothing, and 90° rotation swapping the footprint.
  Learner check: Run `npm test`, confirm green, and open one failure test to see how a violation describes
  itself.
  Commit: `Add build validator: seven rules, violations as data`

- [x] **4. You can ask in the chat and get three clickable ideas built on MCP**
  Becomes usable: The chat works — greeting on load, then asking returns exactly three idea cards streamed in;
  they are real `McpServer` tools over the in-process transport, with schemas listed from the server.
  Why now: This is the riskiest unfamiliar piece after Rebrickable (the in-memory MCP transport, the agent
  loop, SSE streaming) and everything later — the design loop, refinement — flows through it. Getting this
  green before the 3D work means the schedule riskiest item (canvas) can't hide a broken foundation.
  PRD ref: `prd.md > Asking for ideas`, `prd.md > States and Boundaries`, `prd.md > The Core Journey` (steps 3–4)
  Spec ref: `spec.md > Components > mcp/tools.ts`, `spec.md > Components > The agent loop`,
  `spec.md > Components > ChatPanel`, `spec.md > lib/gemini.ts`
  Build: `mcp/tools.ts` (five plain functions), `mcp/server.ts` (per-request `InMemoryTransport` pair),
  `lib/loop.ts` (hand-rolled, six-turn cap — no design loop yet), `lib/gemini.ts` (model constant + prompt
  builder; provider switched from Anthropic to Gemini at this checkpoint — see the deviation note below),
  `lib/sse.ts`, ChatPanel with the five event types, Ideas rendering as clickable cards. Requires
  `GEMINI_API_KEY` in `.env.local`.
  Verify (mechanical): Curl `POST /api/chat` with `{messages:[{role:"user",content:"what can I build?"}], ...}`
  → SSE stream contains `ideas` with exactly three items; second POST with an empty inventory → the "add a set
  first" reply path.
  Learner check: Ask in the chat yourself, confirm three idea cards appear, and click one to see it become
  your message. Watch for the greeting on first load.
  Commit: `Embedded chat over in-process MCP with three grounded ideas`

- [x] **5. Pick an idea and watch the self-correction loop produce a valid build**
  Becomes usable: Clicking an idea makes Claude design in grid coordinates, call `validate_build`, read the
  returned violations, edit itself, and return a build the browser counts against the pool. The kernel strip
  goes live: red with the specific violation, then green. The three-strike drop rule closes the guarantee.
  Why now: This is the kernel made visible — the moment the product proves its claim — and it directly
  produces the recorded self-correction evidence the spec demands as build output.
  PRD ref: `prd.md > The inventory guarantee (the kernel)`, `prd.md > Designing in 3D`
  Spec ref: `spec.md > Components > The agent loop`, `spec.md > Components > validateBuild`,
  `spec.md > Components > KernelStrip`, `spec.md > Decisions and Open Issues` (the evidence requirement)
  Build: `validate_build` tool wired into the MCP server; build event to the browser; `KernelStrip`
  verified/violation states with the buildable-count denominator; three-strike drop rule in `lib/loop.ts`;
  counter `used / buildable`.
  Verify (mechanical): Script (Node) that runs the loop against a deliberately over-quantity build and shows in
  the transcript: first `validate_build` → `ok:false`, second call → `ok:true` — the recorded evidence the spec
  requires; then a live run through the real `/api/chat` where the streamed events include `build` and `kernel`.
  Learner check: Click an idea, watch the strip show used/available, and if you want, type "make it bigger" —
  the counter should change and stay green.
  Commit: `Self-correction loop: validate, fix, and drop on six-turn failure`

- [x] **6. The build appears as real bricks, assembling layer by layer**
  Becomes usable: The validated design renders in 3D — beveled bodies, cylindrical studs, angled slope faces —
  on a warm stud baseplate with studio lighting; bricks appear bottom-up on a reveal interval and the model
  can be orbited.
  Why now: The app already proves and counts the kernel; this slice is the demo's visual payoff, and it is the
  build's most fiddly, least testable work, so it gets its own slice with the flat-box fallback on standby.
  PRD ref: `prd.md > Designing in 3D`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Look and Feel`, `spec.md > Components > BuildCanvas`, `spec.md > File Structure > scene/`
  Build: `scene/brickGeometry.ts` (cached per-shape geometry: body, studs, slope faces), `BrickMesh`, `Scene`
  (lights, drei environment, OrbitControls, baseplate), BuildCanvas with sorted-by-y reveal (~25ms). Colors
  from Rebrickable color IDs.
  Verify (mechanical): Load `?fixture=kart` (a canned PlacedBrick[] fixture, dev-only) → canvas renders the
  expected brick count as instanced meshes, slopes show angled faces, zero console errors, orbit works.
  Learner check: Confirm the bricks look like LEGO rather than flat boxes, watch the layer-by-layer assembly,
  and spin it.
  Commit: `Procedural brick geometry with staged reveal`

- [x] **7. Refine in plain language and handle every failure without breaking the page**
  Becomes usable: The full journey holds under abuse: "make it taller" redesigns and revalidates; a bad set
  number draws the inline error; an API failure produces one line in the chat with the page intact; a set with
  nothing renderable is refused with an honest message; localStorage-unavailable degrades gracefully.
  Why now: The goodwill pass — every PRD state gets real, and the video can be recorded without the demo
  collapsing on a bad key or a 429.
  PRD ref: `prd.md > Refining`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Important Failure Modes`, `spec.md > lib/sse.ts`
  Build: Refine path (history carries the prior design); error event handling in ChatPanel; Rebrickable
  404/401/429 mapping into the inline error; empty-buildable-set refusal; localStorage notice; model-provider
  failure (rate limit, timeout, bad key) → chat line only.
  Verify (mechanical): Break the model key → chat shows the error line, canvas and collection intact,
  page usable; POST a malformed message → zod rejection returned as a tool result; unknown set → inline error
  under the field; private-browsing simulation → one notice, app still runs.
  Learner check: Do the full journey start to finish — add a set, ask, pick, refine — then try to break it
  with a bad set number and tell me what you saw.
  Commit: `Refinement path and failure states across the journey`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 4: toolbar + collection + a working chat with idea cards;
      feedback on idea quality, card feel, and greeting copy while only slices 6–7 remain.
      *Status: the learner used the app hands-on during the build (added sets, asked for ideas, clicked
      one). Formal feedback on idea quality / card feel / greeting copy has not been collected yet.*
- [ ] Final kick-the-tires exploration and feedback completed — full core journey plus awkward inputs, after slice 7.
      *Status: the mechanical kick-the-tires pass is done (below); the learner's feedback is pending.*

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

*Mechanical review, after slice 7 (learner feedback still to come):*
- `npm test` → 43 tests green; `npx tsc --noEmit` clean; `npm run build` succeeds.
- Core journey re-run through the real UI: add a set → ask → three idea cards → click one → model designs
  in grid coordinates → kernel red with the specific complaint → model self-corrects → green → build
  renders in 3D (studs, bevels, shadows) → "make it taller" edits the design on the canvas.
- Failure states: bad set number (client and server), nonexistent set, bad model key, free-tier 503,
  timeout, empty design, storage refusal — each degrades to one honest line, page intact.
- Two defects found and fixed in the review: the client fetched only the first page of a set's parts
  (the kernel's denominator was wrong for big sets), and the camera aimed at absolute coordinates while
  the bricks were drawn relative to the origin.

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

*Status: the app map is generated and checked (served standalone, no network dependencies, verified in a
browser: 6 sections, 3 stops, an SVG of one real action, "to change this, start here" pointers, and a
practice to reuse grounded in the kernel's evidence). The learning activity with the learner is pending —
it is anchored to their stated goal (understanding MCP): the project now has a real MCP server in two
hosts, the in-process one the app uses and `mcp/stdio.ts` that a judge can register.*

Activity and evidence: [what actually happened; real document/test/code references; unfinished work if interrupted]
Route and stops: [actual paths and symbols; guided stops completed, or reference-only route]
Edit outcome: [tried/kept/reverted/declined/not applicable; verification if changed]
Reflection: [offered/answered/declined/already covered — personal answer belongs only in the ignored profile]
Activity mode: [live app and editor, explicit static fallback, focused alternative, prior practice, or recap]

## Revisions

- **Model provider: Anthropic → Google Gemini free tier.** The slice-4 checkpoint's learner decision:
  no card, no prepaid minimum. `lib/anthropic.ts` became `lib/gemini.ts`; the loop speaks
  `streamGenerateContent?alt=sse` with function declarations (unsupported schema fields stripped), while
  the MCP server, the five tools, the validator, and every SSE event type stayed unchanged. The spec's
  Anthropic sections were rewritten to match; `scope.md` keeps its original planning text under a
  one-paragraph build note because it is the approved pre-build record.
- **Model ID by live test, not by lineup.** `gemini-3.8-flash` was listed by the account but hung with zero
  bytes; `gemini-2.5-flash` is closed to new users. `gemini-3.6-flash` answers in ~3.5s and is the constant.
- **Persona mentions of "Claude"/"Anthropic" in the PRD/scope are historical.** The grounded-chat
  behavior (three ideas, kernel, self-correction) is provider-independent; the built app uses Gemini.
- **One model became a chain with retry.** The free tier congests: `gemini-3.5-flash` returned 503
  "high demand" while `gemini-3.1-flash-lite` answered in 4s. `lib/gemini.ts` now walks a chain
  (`3.5-flash` → `3.1-flash-lite`), retries once with backoff, and turns a persistent 503/429 into
  one plain chat line instead of a spinner.
- **The inventory now carries the colour id.** The model was guessing `colorId` values and produced
  23 "isn't available in <colour>" violations per attempt. Rows are now `… | colour (colour id N) | qty`.
- **An empty design is not a build.** A zero-brick list used to pass the kernel vacuously and produce
  a build event with 0 bricks. `validate_build` and `save_build` now refuse an empty design, and the
  three-strike fallback only emits a build when at least one brick survives.
- **`?demo=1` instead of `?fixture=kart`.** The slice-6 plan called for a canned fixture route. The
  demo hook instead assembles a small legal build FROM THE USER'S OWN COLLECTION
  (`lib/sampleBuild.ts`), so it can never show a brick the user doesn't have — the same rule the
  product makes everywhere else. It is also a deterministic shot for the demo video.
- **A dead provider no longer loses a good design.** The free tier's 503 could kill the request
  between `validate_build` (which passed) and `save_build`, throwing away a design the kernel had
  already accepted. The provider call is now caught per turn: the loop stops, the user gets one
  honest line, and the three-strike fallback still delivers the validated build.

Pending doc polish (ship stage): regenerate `scope.html` / `spec.html` from their Markdown so the rendered
artifacts carry the provider note; README must credit Rebrickable and document `GEMINI_API_KEY`.
