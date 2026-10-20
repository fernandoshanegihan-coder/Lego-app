---
doc: prd
status: approved
---

> Visual companion: `devpost/prd.html`. **This Markdown file is the canonical document.**

# Brickbrain — Product Requirements

Brickbrain is a web app where a creative student enters the set numbers of the LEGO sets they own, and
Claude designs a build they can actually make — rendered in 3D, using only the exact bricks in their
collection.
Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`, `scope.md > The Core Loop`.

## The Core Journey

1. **Arrive.** The page opens on an empty 3D brick canvas beside a chat panel. A slim toolbar above the
   canvas holds a dedicated set-number field and the user's collection. The chat greets them:
   *"Enter a set number to get started"*, plus one line on what the app does.
2. **Add a set.** They type a set number into the dedicated field. The app fetches that set's parts from
   the Rebrickable API, stores them, and confirms in the field with the set's name and part count —
   *"21328 — Lego Ideas (1,234 parts)"*. The collection list gains an entry.
3. **Ask.** They type *"what can I build with these?"* in the chat. Claude reads the collection and replies
   with exactly **three** build ideas, each a title plus a short description of what it is and roughly what
   it would take. Text only — no previews.
4. **Pick.** They click one of the three ideas.
5. **Design.** Claude designs the build using only parts in the collection, at a size scaled to the pool
   (one set → ~30–60 bricks; five sets → ~150–250 bricks). The kernel strip along the canvas shows the live
   brick count and any inventory violation as it happens.
6. **See it.** The bricks appear in the 3D view, layer by layer. The user can orbit the model. The counter
   reads *"47 / 312"*.
7. **Refine.** They say *"make it taller"* in plain language and the design updates.
8. **Success.** The user is looking at a 3D build made only of bricks they own, every brick counting against
   their real inventory.

## Screens and Layout

One page, two surfaces. No separate screens, no navigation, no routes.

```
┌──────────────────────────────────────────────────┬───────────────────┐
│ Brickbrain   [ Add a set: 21328      ]  Your     │                   │
│               sets: 3 · 1,904 parts              │      Chat         │
│                                                  │                   │
│                                                  │  (history)        │
│              3D CANVAS                           │                   │
│                                                  │                   │
│                                                  │  [type a message] │
├──────────────────────────────────────────────────┤                   │
│ ✓ every brick verified against your inventory 47/312                 │
└──────────────────────────────────────────────────┴───────────────────┘
```

- **Canvas** (left, dominant): a recessed warm surface with a faint stud grid. The bricks are the only
  saturated thing on screen. The kernel strip runs along its bottom edge.
- **Chat panel** (right): conversation history, input at the bottom. Claude's messages are plain text
  blocks; the user's messages carry a yellow left-bar.
- **Toolbar** (above the canvas): the app name, the dedicated set-number field, and the collection summary.
  The full collection list is available here.
- **Movement:** none. The only two things a user does are *add a set* (toolbar) and *talk* (chat panel).

> **Assumption:** the set field and collection summary share one slim toolbar above the canvas. The learner
> specified a dedicated field but not its exact placement.

## Look and Feel

**"The workbench in daylight."** Warm off-white, LEGO colours doing all the work.

| Role | Value |
|---|---|
| Bench (page background) | `#f5f1e8` |
| Canvas surface | `#ebe5d8` |
| Raised panel (chat, cards, toolbar) | `#fbf9f4` |
| Edge | `#e2dccf` |
| Ink / dim ink | `#2a2620` / `#7a7263` |
| Accent | `#ffd814` — graphic only (fills, borders, highlights), never body text on off-white |
| Verified | text `#1c7a45` on `#e4f3ea` |
| Violation | text `#a81f16` on `#fbe9e7` |

- **Type:** **Space Grotesk** for UI and headings; **JetBrains Mono** for part numbers and the brick counter,
  so *"47 / 312"* reads like an instrument rather than a label.
- **Chat:** plain text blocks, not rounded bubbles. User messages get a 3px yellow left-bar.
- **Suggestions:** three rows on raised panels. Hover lights the yellow left-bar and lifts the row slightly.
- **Canvas:** a faint warm stud baseplate, soft vignette, model sits in light. The bricks are **real geometry**
  — beveled bodies, cylindrical studs on top, angled top faces on slopes — never flat coloured boxes.
- **Kernel strip:** a light bar on the canvas edge — green dot, *"every brick verified against your
  inventory"*, live count in mono. A violation flashes the red row with the specific problem (*"you have 2
  red 2×4s, the design used 4"*), then resolves green once Claude fixes it.
- **Avoid:** purple/indigo gradients, glassmorphism, emoji icons, "✨ Here's what I found!" headings.

Source: `scope.md > Inspiration & Identity`.

## Features and Behavior

### Adding a set

The user enters a set number in the dedicated field. The app fetches that set's parts from Rebrickable,
adds them to the collection, and confirms.

- The field is **dedicated** — the app always knows that text is a set number, never a message.
- Confirmation replaces the field's placeholder with the set's name and part count.
- The collection summary in the toolbar updates immediately.
- The same set added twice is not double-counted.
- The confirmed count is the **box count** — every part in the set. The **buildable count** is lower: only
  bricks, plates, tiles, and common slopes can be drawn, and a part that cannot be drawn cannot be claimed. The
  kernel strip uses the buildable count and labels it.

- [ ] Entering a valid set number shows its name and part count in the field, and the collection total rises
- [ ] The collection summary shows the number of sets and total parts
- [ ] Adding a set already in the collection does not increase the total
- [ ] The set's parts are available to Claude on the next message

### Asking for ideas

The user asks in natural language. Claude replies with **exactly three** build ideas, grounded in the parts
actually in the collection. Each idea is a title plus a short description of what it is and roughly what it
would take.

- Ideas are **text only**. No preview images or thumbnails.
- The three ideas are clickable rows in the chat.
- Ideas reflect the parts available — a house if there are house parts, a car if there are car parts.
- If the collection cannot support a good build, Claude says so plainly and offers what *is* possible,
  rather than proposing something flimsy.

- [ ] Asking with a populated collection returns exactly three ideas
- [ ] Each idea shows a title and a description
- [ ] Each idea can be clicked to proceed
- [ ] With a collection of only tiny plates, the reply says the parts can only make small abstract shapes

### Designing in 3D

Clicking an idea sends it to Claude, which designs the build and returns it as structured brick data. The
app renders it in the canvas.

- Build size is scaled to the collection: one set → ~30–60 bricks; five sets → ~150–250 bricks. This is a
  **target the prompt asks Claude to aim for, not a hard limit.** The only hard rule is which parts exist in
  the collection — a 200-brick build from a 300-part set is perfectly legal.
- Every brick is drawn as **real LEGO geometry** — beveled body, cylindrical studs on top, angled top face on
  slopes. This is what makes the model read as LEGO on video rather than as a voxel blob.
- Bricks appear **layer by layer**, so the build assembles itself on screen.
- The user can orbit the model, which sits on a faint stud baseplate.
- The kernel strip shows the running count as bricks are placed.

- [ ] Clicking an idea produces a 3D model built from the collection's parts
- [ ] Bricks appear progressively rather than all at once
- [ ] The model can be rotated
- [ ] Bricks render with visible studs, bevels, and depth — not as flat rectangles
- [ ] A build containing a slope shows an angled face, not a cube
- [ ] The counter updates as bricks are placed and ends showing used and available counts
- [ ] A build larger than the size target is allowed, as long as every brick is in the collection

### The inventory guarantee (the kernel)

The app cannot display a brick the user does not own. Enforced in three layers, and **visible to the user**.

1. **The prompt contains only the user's parts.** Claude is never told about a part outside the collection.
2. **`validate_build` checks every brick** — part exists in the collection, color matches, quantity within
   stock, sits on the stud grid with support underneath.
3. **Invalid bricks are dropped.** If Claude exhausts its attempts, the offending brick is removed rather
   than rendered.

- [ ] Every brick in the rendered model corresponds to a part in the user's collection
- [ ] A quantity overrun is reported to the user in the kernel strip before it is resolved
- [ ] A colour the user does not own is never rendered
- [ ] The final count of used parts never exceeds the collection total

### Refining

The user describes a change in plain language and the design updates, revalidated against the collection.

- [ ] "make it taller" produces an updated model
- [ ] The refined design is revalidated against the collection
- [ ] The counter reflects the updated build

### The collection

The user's sets live in the browser and survive a page reload.

- [ ] Closing and reopening the page keeps the collection
- [ ] The collection summary reflects the saved sets

## States and Boundaries

- **First use, nothing added** — empty canvas, greeting in the chat (*"Enter a set number to get started"*
  plus one line on what the app does), empty collection summary.
- **Asking before adding a set** — Claude replies that it needs a set first and cannot suggest anything yet.
  The canvas stays empty.
- **Invalid set number** — an **inline error under the input box**. The field keeps the typed text, the
  collection is unchanged, the chat is unaffected.
- **Claude or the API fails** — an error appears in the chat. The canvas and the collection are unchanged
  and the page never white-screens.
- **Claude proposes a brick the user doesn't own** — the kernel strip flashes the violation with the
  specific problem, Claude corrects itself, the brick resolves to a valid one or is dropped.
- **Parts too poor to build anything good** — Claude says so honestly and offers what is possible.
- **What persists** — the collection (browser storage). **What does not** — the current chat and the current
  build are lost on reload.
- **Boundary** — one user's browser, one collection, no accounts, no sharing, no server-side user data.

## Product Decisions

- **Exactly three ideas, text only.** The learner cut the preview images — it saved three extra Claude
  calls and a whole second rendering mode, and the demo does not need it.
- **A dedicated set-number field**, not set numbers typed into the chat. It keeps the chat purely
  conversational and makes adding a set unambiguous.
- **Inline error under the field** for a bad set number, rather than a message in the chat — the error
  belongs next to the input that caused it.
- **Errors in the chat** for API and Claude failures. The page must stay usable.
- **The kernel is visible in the UI.** The constraint is the product's whole claim, so it is surfaced rather
  than hidden in the backend.
- **Warm off-white, Space Grotesk.** Chosen by the learner from two offered directions.
- **Named Brickbrain.**
- **No sign-ups.** Collections live in the browser.
- **Three ideas** rather than more — fewer is faster to read and to build.
- **The size target is a prompt instruction, not a validator rule.** The only hard limit is which parts
  exist in the collection.
- **Procedural brick geometry, not the LDraw library.** Studs, bevels, and slopes drawn in code. It makes the
  renderer's vocabulary and the validator's vocabulary the same set — a part that cannot be drawn cannot enter
  the collection — at a fraction of LDraw's integration risk. Tradeoff: no curved slopes, Technic, or printed
  parts.
- **The parts-list sidebar stays out.** The reference image had one, but the kernel strip's *47 / 312* already
  states the tally and the PRD rules sidebars out.

## What We're Building

1. A single page: canvas, chat panel, toolbar with the set field and collection summary.
2. Rebrickable fetching and storage of a set's parts.
3. An embedded chat that calls Claude with the user's collection as its only parts source.
4. Three grounded build suggestions per request.
5. A structured-brick design response, rendered as real LEGO geometry — studs, bevels, slopes — assembling
   layer by layer.
6. The three-layer inventory guarantee, with violations surfaced in the kernel strip.
7. A live used/available brick counter.
8. Plain-language refinement.
9. Honest handling of parts that cannot make a good build.
10. Collection persistence in the browser.

## Deferred From the POC

- **Accounts and cloud-synced collections.** The audience is students and the brief is explicit — no sign-ups.
  It also removes an auth provider, a database, and a per-user hosting cost from the build.
- **Preview images for suggestions.** Cut to keep the build inside the time budget.
- **A deployed instance.** Optional for the hackathon; a local run and a public repo are what is required.
- **Exotic part geometries.** The POC draws bricks, plates, tiles, and a small set of common slopes. Wedges,
  round bricks, arches, Technic, and printed parts are excluded from the renderer — and therefore, by
  construction, excluded from Claude's pool as well.
- **Saving designs beyond the current session.** The collection persists; the build does not.
- **Usage caps.** The API costs per token. Fine at demo scale; a real product needs a cap before real traffic.

## Possible Later Enhancements

- Register the MCP server so Claude Code and claude.ai can drive the builder.
- A parts-list and build-instructions export.
- "Buy the missing parts" — surface BrickLink / BrickOwl links for the shortfall.
- Multiple designs side by side for the same collection.
- **The LDraw parts library** — authentic geometry for nearly every part ever made, replacing the procedural
  shapes.
- More part geometries and printed part images.

## Non-Goals

- **No image-to-brick generation.** Photo → mosaic is a computer-vision problem in its own right and is not
  this project's job. Claude composes the model rather than deriving it from a photo.
- **No PDF build guides, parts lists, or GIF export.** Not needed to prove the kernel or the core loop.
- **No claude.ai as the chat client.** The chat lives on this page; the user never leaves the site.
- **No purchases, pricing, or store.** Out of scope for a proof of concept.
- **No accounts, sign-in, or shared collections.**
- **No mobile-first layout.** The demo is a desktop experience.

## Open Questions

- **Does the current build survive a page reload?** Default is no — only the collection persists. Low
  impact; can be settled during the build if it turns out to matter.
- **Exact greeting wording.** The content is settled ("Enter a set number to get started" plus a line on
  what the app does); the phrasing is drafted in the build. Can wait.
- **Is the collection list collapsible?** Default is a compact always-visible summary. Can wait.
