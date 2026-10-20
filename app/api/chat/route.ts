import { z } from "zod";
import { encodeSse, type ChatEvent, type ChatEventHandler } from "@/lib/sse";
import { geminiKey, systemPrompt, currentDesignBlock, MissingGeminiKeyError } from "@/lib/gemini";
import { runLoop } from "@/lib/loop";
import { createChatMcp } from "@/mcp/server";
import { aggregate } from "@/lib/collection";
import type { PlacedBrick, StoredSet } from "@/lib/types";

export const runtime = "nodejs";

/**
 * app/api/chat/route.ts — one request, one conversation. `spec.md > Components`.
 * The inventory travels with every request; the server holds none of it.
 */

const partSchema = z.object({
  partNum: z.string(),
  name: z.string(),
  category: z.enum(["brick", "plate", "tile", "slope"]),
  w: z.number().int().positive(),
  d: z.number().int().positive(),
  h: z.number().int().positive(),
  colorId: z.number().int(),
  colorName: z.string(),
  colorHex: z.string(),
  isTrans: z.boolean(),
  quantity: z.number().int().positive(),
});

const storedSetSchema = z.object({
  setNum: z.string(),
  name: z.string(),
  year: z.number().int(),
  totalParts: z.number().int(),
  buildableParts: z.number().int(),
  parts: z.array(partSchema),
  addedAt: z.number(),
});

/** The design already on the canvas, so a refinement can edit it. */
const currentBuildSchema = z.object({
  id: z.string(),
  partNum: z.string(),
  colorId: z.number().int(),
  colorName: z.string(),
  colorHex: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(40),
  inventory: z.array(storedSetSchema).max(20),
  currentBuild: z.array(currentBuildSchema).max(500).optional(),
});

/**
 * A POST handler that streams events. The response helper keeps the route a
 * plain function: `handler(send)` writes events; the reader closes on return.
 */
function sseResponse(handler: (send: ChatEventHandler) => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send: ChatEventHandler = (event: ChatEvent) => {
        controller.enqueue(enc.encode(encodeSse(event)));
      };
      try {
        await handler(send);
      } catch (err) {
        // The page must never white-screen — an error is one chat line.
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Something went wrong. Try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "malformed-request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    // Say WHICH field failed — a developer running this needs that.
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "body";
    return Response.json(
      {
        error: "malformed-request",
        message: `Bad chat payload (${where}: ${issue?.message ?? "invalid"}).`,
      },
      { status: 400 },
    );
  }
  const { messages, inventory, currentBuild } = parsed.data as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    inventory: StoredSet[];
    currentBuild?: PlacedBrick[];
  };

  const pool = aggregate(inventory);

  // PRD boundary: asking before adding a set cannot reach the model at all.
  if (pool.size === 0) {
    return sseResponse(async (send) => {
      send({ type: "text", text: "You haven't added a set yet. Type a set number above — then I'll see what we can build from it." });
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return sseResponse(async (send) => {
      send({
        type: "error",
        message: "The Gemini key isn't configured on this server. Add GEMINI_API_KEY to .env.local and reload.",
      });
    });
  }

  return sseResponse(async (send) => {
    const ctx = {
      pool,
      sets: inventory,
      ideas: undefined,
      kernelResult: undefined,
      savedBuild: undefined,
    };
    const mcp = await createChatMcp(ctx);
    try {
      await runLoop({
        system: systemPrompt(pool) + currentDesignBlock(currentBuild ?? []),
        tools: mcp.anthropicTools,
        mcpClient: mcp.client,
        ctx,
        messages,
        emit: send,
      });
    } finally {
      await mcp.close();
    }
  });
}
