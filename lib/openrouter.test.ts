import { describe, expect, it } from "vitest";
import { readOpenAiStream, toOpenAiMessages } from "@/lib/openrouter";
import type { NeutralPart, Turn } from "@/lib/provider";

/**
 * OpenRouter speaks the OpenAI chat format, which differs from Gemini's in
 * two ways that matter here: text arrives as `delta.content`, and a tool
 * call's arguments arrive in fragments spread across chunks. The parser has
 * to stitch those back together before the model can be given the call.
 */

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function delta(content: string) {
  return { choices: [{ delta: { content } }] };
}

function toolDelta(index: number, id: string, name: string, args: string) {
  return { choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] } }] };
}

describe("readOpenAiStream", () => {
  it("yields text deltas as they arrive", async () => {
    const res = sse([delta("Hello "), delta("there.")]);
    const parts: NeutralPart[] = [];
    for await (const part of readOpenAiStream(res)) parts.push(part);

    expect(parts).toEqual([
      { kind: "text", text: "Hello " },
      { kind: "text", text: "there." },
    ]);
  });

  it("stitches a tool call's arguments back together", async () => {
    const res = sse([
      toolDelta(0, "call_1", "validate_build", '{"bricks":'),
      toolDelta(0, "", "", '[{"partNum":"3001",'),
      toolDelta(0, "", "", '"x":0,"y":0,"z":0,"rot":0}]}'),
    ]);

    const parts: NeutralPart[] = [];
    for await (const part of readOpenAiStream(res)) parts.push(part);

    expect(parts).toHaveLength(1);
    const call = parts[0] as Extract<NeutralPart, { kind: "toolCall" }>;
    expect(call.kind).toBe("toolCall");
    expect(call.name).toBe("validate_build");
    expect(call.id).toBe("call_1");
    expect(call.args).toEqual({
      bricks: [{ partNum: "3001", x: 0, y: 0, z: 0, rot: 0 }],
    });
  });

  it("survives a torn chunk and the [DONE] marker", async () => {
    const body = `data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":\n\ndata: [DONE]\n\n`;
    const res = new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    const parts: NeutralPart[] = [];
    for await (const part of readOpenAiStream(res)) parts.push(part);
    expect(parts).toEqual([{ kind: "text", text: "ok" }]);
  });
});

describe("toOpenAiMessages", () => {
  const history: Turn[] = [
    { role: "user", parts: [{ kind: "text", text: "build a tower" }] },
    {
      role: "model",
      parts: [
        { kind: "text", text: "on it" },
        { kind: "toolCall", id: "c1", name: "validate_build", args: { bricks: [] } },
      ],
    },
    {
      role: "user",
      parts: [
        { kind: "toolResult", id: "c1", name: "validate_build", response: { ok: true } },
      ],
    },
  ];

  it("puts the system prompt first", () => {
    const messages = toOpenAiMessages("be brief", history) as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: "be brief" });
  });

  it("turns a model turn with a tool call into an assistant message with tool_calls", () => {
    const messages = toOpenAiMessages("s", history) as Array<Record<string, unknown>>;
    const assistant = messages.find((m) => m.role === "assistant") as Record<string, unknown>;
    expect(assistant.content).toBe("on it");
    expect(assistant.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "validate_build", arguments: '{"bricks":[]}' },
      },
    ]);
  });

  it("turns a tool result into a tool message with the matching call id", () => {
    const messages = toOpenAiMessages("s", history) as Array<Record<string, unknown>>;
    const toolMessage = messages.find((m) => m.role === "tool") as Record<string, unknown>;
    expect(toolMessage.tool_call_id).toBe("c1");
    expect(toolMessage.content).toBe('{"ok":true}');
  });
});
