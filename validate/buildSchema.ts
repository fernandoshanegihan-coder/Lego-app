/**
 * The zod contract for Claude's build tool-call. `spec.md > Components > MCP`.
 *
 * The schema is deliberately strict - the model writes JSON and JSON lies.
 * Anything that fails here never reaches the validator as a "violation";
 * it fails the tool call itself, and the agent loop feeds the zod message
 * back so the model can fix its own argument shape.
 *
 * Note the layering: zod checks the SHAPE of the argument; `validateBuild`
 * checks its LEGALITY against the pool. Non-integer coordinates fail both -
 * the schema first, and the validator still guards on its own (pure layers
 * don't trust their callers).
 */
import { z } from "zod";

export const placedBrickSchema = z.object({
  /** Optional: the server numbers the bricks when the model omits it. */
  id: z.string().min(1).optional(),
  partNum: z.string().min(1),
  colorId: z.number().int(),
  colorName: z.string().min(1),
  /** Optional: the server fills the real hex from the pool, so the model
   *  never has to guess a colour code — but a wrong one is still rejected. */
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  rot: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});

export const buildSchema = z.object({
  bricks: z.array(placedBrickSchema).max(2000),
});

export type BuildInput = z.infer<typeof buildSchema>;
