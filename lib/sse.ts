/**
 * The five event types on the wire, and the SSE encoding. `spec.md > On the wire`.
 *
 * Shared with the browser: no server-only imports here.
 */

export interface Idea {
  title: string;
  description: string;
}

export type ChatEvent =
  /** A streaming text block — rendered as prose in the chat. */
  | { type: "text"; text: string }
  /** Exactly three ideas — rendered as clickable IdeaCards. */
  | { type: "ideas"; ideas: Idea[] }
  /** An accepted design — bricks handed to the canvas. */
  | { type: "build"; name: string; bricks: unknown[]; used: number; available: number }
  /** A kernel pass or violation list — shown in the strip. */
  | {
      type: "kernel";
      ok: boolean;
      used: number;
      available: number;
      violations?: Array<{ brickIndex: number; rule: string; detail: string }>;
      dropped?: number;
    }
  /** A plain error line in the chat. */
  | { type: "error"; message: string };

export type ChatEventHandler = (event: ChatEvent) => void;

/** One event → one `data:` line, blank-line terminated (the SSE convention). */
export function encodeSse(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
