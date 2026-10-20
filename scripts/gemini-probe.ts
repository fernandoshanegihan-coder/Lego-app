/**
 * scripts/gemini-probe.ts — debug helper (not part of the app).
 *
 * Sends the SAME request shape the chat route sends, straight to Gemini, and
 * prints the raw SSE so we can see exactly what comes back: function calls,
 * thought parts, empty text, or an error the route would swallow.
 *
 * Run: npx tsx scripts/gemini-probe.ts
 */
import { readFileSync } from "node:fs";
import { MODEL, toFunctionDeclarations } from "@/lib/gemini";
import type { AnthropicTool } from "@/mcp/tools";

// tsx doesn't load .env.local the way Next does — do it by hand.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}

const tools: AnthropicTool[] = [
  {
    name: "validate_build",
    description: "Checks a proposed brick list against the user's inventory.",
    input_schema: {
      type: "object",
      properties: {
        bricks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              partNum: { type: "string" },
              colorId: { type: "integer" },
              colorName: { type: "string" },
              x: { type: "integer" },
              y: { type: "integer" },
              z: { type: "integer" },
              rot: { type: "integer" },
            },
            required: ["partNum", "colorId", "colorName", "x", "y", "z", "rot"],
          },
        },
      },
      required: ["bricks"],
    },
  },
];

const body = {
  systemInstruction: {
    parts: [
      {
        text: "You design LEGO builds. When the user asks for a build, you MUST call validate_build with the brick list.",
      },
    ],
  },
  contents: [{ role: "user", parts: [{ text: "Build a small 2x4 brick tower. Call validate_build with the bricks." }] }],
  tools: [{ functionDeclarations: toFunctionDeclarations(tools) }],
  generationConfig: { maxOutputTokens: 4096 },
};

async function main() {
  const models = process.argv.slice(2);
  const list = models.length ? models : [MODEL];

  for (const model of list) {
    console.log(`\n===== ${model} =====`);
    const bodyFor = {
      systemInstruction: {
        parts: [
          {
            text: "You design LEGO builds. When the user asks for a build, you MUST call validate_build with the brick list.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Build a small 2x4 brick tower. Call validate_build with the bricks.",
            },
          ],
        },
      ],
      tools: [{ functionDeclarations: toFunctionDeclarations(tools) }],
      generationConfig: { maxOutputTokens: 4096 },
    };

    const started = Date.now();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        },
        body: JSON.stringify(bodyFor),
      },
    );

    const raw = await res.text();
    const ms = Date.now() - started;
    const hasFunctionCall = raw.includes('"functionCall"');
    const hasText = /"text"\s*:\s*"[^"]+/.test(raw);
    const error = raw.startsWith("{") && raw.includes('"error"') ? raw.slice(0, 160) : "";

    console.log(
      `status=${res.status} time=${ms}ms functionCall=${hasFunctionCall} text=${hasText} ${error}`,
    );
    if (hasFunctionCall) {
      const idx = raw.indexOf('"functionCall"');
      console.log("  call:", raw.slice(idx - 40, idx + 200).replace(/\n/g, " "));
    }
  }
}

void main();
