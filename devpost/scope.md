---
doc: scope
status: approved
---

> Visual companion: `devpost/scope.html` — self-contained, no network needed, no build step.
> **This Markdown file is the canonical document.** The HTML is regenerated after each revision.
>
> **Build note (provider):** this scope was written planning on Anthropic's Claude API. During the build
> the learner chose Google's Gemini free tier instead (`lib/gemini.ts`, no credit card). Everything else in
> this document — the kernel, the MCP design, the journey — is unchanged. Every "Anthropic"/"Claude"
> mention below refers to that original plan; the built app uses Gemini.

# Brickbrain *(working name — rename freely)*

Ask an AI what you can build from the LEGO sets you already own, and watch it design it in 3D — using only the exact bricks you have.

## The Unique Kernel

Claude designs a build using **only the exact parts, colors, and quantities the user owns**. The app cannot
show a brick the user doesn't have: every brick is validated against their inventory before it renders, and
if the model cheats the offending brick is dropped rather than displayed.

A design that looks right but uses parts you don't own is worthless to the person trying to build it. So this
project doesn't ask Claude for a build — it asks for a build **constrained to one specific pile of bricks**, and
then proves it.

## Who It's For

**Creative students who want to build something new.** They own LEGO sets — or the parts from sets they've
taken apart — and they want to make something original without spending money on more bricks. A student who
can't afford to buy the parts for a design is exactly the person for whom "build it with what you already
own" is the difference between making something and not.

Today they solve it by scrolling BrickLink for parts, assembling something in their head, or abandoning the
idea because the parts list costs more than the hobby is worth.

They do not need an Anthropic account, and they should not have to leave the site to use Claude.

## The Core Loop

1. User enters a set number they own → the app fetches that set's parts from the Rebrickable API and saves them
2. User adds a second, third, fifth set → the parts pool grows
3. User asks *"what can I build with these?"* → Claude suggests a few build ideas grounded in the actual parts
4. User picks one → Claude designs it
5. The bricks appear in the 3D view and can be spun around
6. User refines in plain language (*"make it taller"*) → the design updates

They come back each time they open a new set from their pile.

**Build size scales with the pool**, and the numbers go into the prompt that tells Claude how big to aim:

| Parts pool | Build size | Target |
|---|---|---|
| One set | Small | ~30–60 bricks |
| Five sets | Medium | ~150–250 bricks |

What gets built depends on what's actually there: a house if they have house parts, a car if they have car
parts.

## Inspiration & Identity

**Quiet workshop bench, not e-commerce.** A 3D brick canvas beside a chat panel — studs, plates, real LEGO
colours — stripped back to one job: turn the bricks you already own into something you can actually build.
No store, no purchase flow, no account system.

## Why This Matters

Three things the product owner asked for by name:

- "Claude uses his brain and suggest some ideas for user" — the AI does the creative thinking, the user directs it
- "The user doesn't need to go to claude.ai, it should be on the same page as my website" — one page, no tab-switching
- "There should not be any cost for me" — see the constraint below

And the audience it serves: **creative students who want to build something new.** For a student without an
Anthropic account and without money for extra bricks, the embedded chat and the "only what you own" rule are
the whole point — they get to make something original with what they already have, without leaving the site
or paying for a subscription.

This is also the kind of project that can go on a public GitHub repo and be submitted to Devpost as a working
proof of concept rather than a mockup.

## Constraint: No Cost to the Developer

Resolved during scoping, not deferred:

| Item | Cost |
|---|---|
| Rebrickable API | **Free**, including commercial use. Free account → API key. Credit Rebrickable as the data source. Rate limit ≈ 1 req/sec, so fetch a set's whole inventory in one call. |
| Anthropic API | Per-token. Haiku 5.5 ≈ $0.001 per design request; Sonnet 5 ≈ $0.023. New accounts get a one-time ~$5 trial credit; the paid Max plan includes $100–$200/month of API credit. A hackathon-scale demo lands around $1–$25 total. |
| Hosting | Free tier is sufficient for a demo. |
| Accounts / database | Cut — collections live in the browser. Nothing per-user to host. |

**Not** a permanent free API tier: the Claude API has no free tier, so "no cost" means "sub-dollar at demo
scale on a cheap model," plus a usage cap if it ever gets real traffic. At scale the options are capping
usage, charging users, or BYOK — all `Later`.

## Integration Mechanism: MCP

**Decision:** Claude reaches the parts tools through an **MCP server**, and the chat stays embedded on our page.

MCP is available directly from the Anthropic API (the `mcp_servers` connector), so this is not a
claude.ai-only arrangement. Two transports matter:

| Transport | Use | Constraint |
|---|---|---|
| Local stdio server + Anthropic SDK MCP helpers | Development, and the local demo | The API connector cannot reach a local stdio server directly — the SDK helper path (`mcpTools` + `toolRunner`) bridges it |
| Remote HTTP server + API connector | Deployment, and registration as a Claude Code / claude.ai connector | Must be publicly exposed over HTTPS |

**The same MCP server serves both.** One implementation, two deployments.

**De-risking rule:** the tool logic lives in one transport-agnostic module. MCP is the *transport*, not the
logic. If the MCP path misbehaves during the build, switching to plain tool use is a one-line change — no
rewrite, no lost work. The demo must never be at the mercy of a beta transport.

**Tool surface (MCP-shaped from day one):**

| Tool | Purpose |
|---|---|
| `get_set_parts` | Fetch a set's parts from Rebrickable and add them to the collection |
| `list_my_parts` | Return the user's current parts pool |
| `validate_build` | Check a proposed build against the pool — part exists, color matches, quantity in stock, sits on the stud grid with support — and return the errors |
| `save_build` | Store an accepted design and report parts used |

`validate_build` is the kernel's enforcer, and making it a *tool Claude calls* is better than a validator
bolted on afterwards: Claude designs, calls `validate_build`, gets back "part 3001 in red — you have 2, you
used 4," and fixes its own design.

**Why this is the hackathon-optimal choice:** the tool surface has to exist regardless of transport, so MCP
costs no duplicated work. It also produces a demo artifact judges can *use* rather than only watch — a judge
can point their own Claude Code at the server and ask it to design a build from a set number they type in.

**MCP does not reduce cost.** Every path here calls the Anthropic API and is billed per token. The only
zero-cost-to-us path is letting claude.ai be the client — and that breaks the core requirement below.

## What "Working" Looks Like

Someone opens the site and sees an empty 3D brick canvas next to a chat panel.

They type a set number (`21328`), press enter, and their parts load in. They ask *"what can I build with these?"*
Claude replies with a few idea suggestions — a small house, a little car, something else that fits those
specific bricks. They click one.

**The bricks start appearing in the 3D view, one layer at a time, and they can spin it around.**
A counter shows *"47 of 312 bricks used"* — and every one of those bricks came from a set they actually own.
They say *"make it taller"* and the design updates.

**The "oh, that's cool" beat:** watching the build assemble itself in 3D, knowing it was composed from
nothing but their own pile.

**The moment that proves the kernel:** if the model reaches for a brick the user doesn't have, the app catches
it — either the model fixes it, or the brick is dropped and the count still reconciles against real inventory.

## The POC Boundary

**In:**

- Enter a set number → fetch and save that set's parts from Rebrickable
- A growing collection of sets; the parts pool is the union of all of them
- Collections stored in the browser — **no accounts, no database**
- Embedded Claude chat on the page, wired to the tools through an **MCP server** — the user never leaves the site
- Claude suggests build ideas grounded in the actual inventory
- User picks one → Claude designs it
- 3D rendering of the design (procedural brick geometry on a stud grid)
- **Three-layer inventory enforcement**: the prompt only contains the user's parts; `validate_build` checks
  every returned brick (part exists, color matches, quantity in stock, sits on the grid with support); invalid
  bricks are dropped so the app can never display an unauthorized brick
- Self-correction loop: `validate_build` returns its errors to Claude as a tool result, so Claude sees the
  problem and fixes its own design — no separate retry machinery needed
- Parts-used counter ("47 of 312")
- Plain-language refinement (*"make it taller"*) — *first thing to drop if the build runs long*
- Honest limits: when the parts genuinely can't make a good build, Claude says so and offers what is possible
  rather than producing something flimsy

**Out of the PoC boundary but worth naming:**

- Only standard brick and plate sizes are rendered as 3D geometry — not the full LEGO parts catalogue
- Rebuilding an existing model in an arbitrary 3D modelling tool — out of scope for this proof of concept
- Mobile-first polish — the demo is a desktop experience

## Later

- **Real accounts** and cloud-synced collections
- **Usage caps / paid tier** once traffic makes the API bill real
- **Register the MCP server with Claude Code and claude.ai connectors**, so a judge or user can drive the
  builder from their own Claude session — *top stretch item; roughly a config file and a README section*
- **More part geometries** — slopes, wedges, round bricks, printed parts
- **Export** parts list / build instructions as a PDF
- **"Buy the missing parts"** — surface BrickLink/BrickOwl links for the shortfalls
- **Multiple designs per conversation** — explore alternatives side by side
- **Deployment** — optional for the hackathon

## Explicitly Cut

| Cut | Why |
|---|---|
| Image-to-brick generation (photo → mosaic, photo → sculpture) | A proof of concept does one thing deeply. Converting a photo into a brick layout is a computer-vision problem in its own right, and it is not this project's job. Claude *composes* the model instead of deriving it from an image. |
| PDF build guides, parts lists, GIF export | Not needed to prove the kernel or the core loop. A design the user can see, spin around, and build from is the whole point; paperwork is not. |
| User accounts / sign-in | Stated requirement: "I don't want sign ups." No auth provider, no database, no per-user cost, and less friction for a reviewer — which matters when the audience is students. |
| claude.ai as the chat client | Stated requirement: "The user doesn't need to go to claude.ai, it should be on the same page as my website." Using claude.ai as the MCP client would be free to the developer, but it breaks the core requirement and takes the user off the site. |
| Multi-user database | Browser storage only. |
| Pricing, payments, purchase flows | Out of scope for a proof of concept. |
