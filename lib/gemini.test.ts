import { describe, expect, it } from "vitest";
import { toGeminiContents, toFunctionDeclarations } from "@/lib/gemini";
import type { Turn } from "@/lib/provider";

/**
 * The wire conversions. These are where a provider's own rules bite: Gemini
 * wants a Struct for a function response (a bare string is INVALID_ARGUMENT),
 * and it only accepts an OpenAPI subset of the JSON schema.
 */

describe("toGeminiContents", () => {
  it("maps a user turn to text parts", () => {
    const history: Turn[] = [{ role: "user", parts: [{ kind: "text", text: "build a tower" }] }];
    expect(toGeminiContents(history)).toEqual([
      { role: "user", parts: [{ text: "build a tower" }] },
    ]);
  });

  it("maps a model turn's tool call to a functionCall", () => {
    const history: Turn[] = [
      {
        role: "model",
        parts: [
          { kind: "text", text: "on it" },
          { kind: "toolCall", id: "c1", name: "validate_build", args: { bricks: [] } },
        ],
      },
    ];
    expect(toGeminiContents(history)).toEqual([
      {
        role: "model",
        parts: [{ text: "on it" }, { functionCall: { name: "validate_build", args: { bricks: [] } } }],
      },
    ]);
  });

  it("wraps a tool result in an object — Gemini rejects a bare string", () => {
    const history: Turn[] = [
      {
        role: "user",
        parts: [
          { kind: "toolResult", id: "c1", name: "validate_build", response: "ok: true" },
        ],
      },
    ];
    expect(toGeminiContents(history)).toEqual([
      {
        role: "user",
        parts: [{ functionResponse: { name: "validate_build", response: { result: "ok: true" } } }],
      },
    ]);
  });

  it("keeps provider-specific parts (thought signatures) in the history", () => {
    const history: Turn[] = [
      { role: "model", parts: [{ kind: "raw", data: { thoughtSignature: "abc" } }] },
    ];
    expect(toGeminiContents(history)).toEqual([
      { role: "model", parts: [{ thoughtSignature: "abc" }] },
    ]);
  });

  it("sends the thinking signature back with the function call", () => {
    // Gemini 3 rejects a functionCall that arrives without its signature.
    const history: Turn[] = [
      {
        role: "model",
        parts: [
          {
            kind: "toolCall",
            id: "c1",
            name: "validate_build",
            args: { bricks: [] },
            signature: "sig-123",
          },
        ],
      },
    ];
    expect(toGeminiContents(history)).toEqual([
      {
        role: "model",
        parts: [{ functionCall: { name: "validate_build", args: { bricks: [] } }, thoughtSignature: "sig-123" }],
      },
    ]);
  });
});

describe("toFunctionDeclarations", () => {
  it("strips the JSON-schema fields Gemini does not accept", () => {
    const declarations = toFunctionDeclarations([
      {
        name: "validate_build",
        description: "checks a build",
        input_schema: {
          type: "object",
          additionalProperties: false,
          $schema: "https://json-schema.org/draft/2020-12/schema",
          properties: {
            bricks: {
              type: "array",
              items: { type: "object", properties: { x: { type: "integer", minimum: 0 } } },
            },
          },
          required: ["bricks"],
        },
      },
    ]);

    expect(declarations[0].parameters).toEqual({
      type: "object",
      properties: {
        bricks: { type: "array", items: { type: "object", properties: { x: { type: "integer" } } } },
      },
      required: ["bricks"],
    });
  });
});
