/**
 * mcp/stdio.ts — the same tools, served over stdio.
 *
 * `spec.md > Components > mcp/stdio.ts`: a ~20-line adapter so the repo ships
 * a REAL MCP server a judge can register with Claude Code. It is not on the
 * app's critical path — the app uses the in-process server — but it proves
 * the tools are transport-agnostic: the same five functions, a different host.
 *
 * The inventory comes from a JSON file (the browser's collection export):
 *
 *   npx tsx mcp/stdio.ts ./collection.json
 *
 * Registered in .mcp.json:
 *   { "mcpServers": { "brickbrain": { "command": "npx", "args": ["tsx", "mcp/stdio.ts"] } } }
 */
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS, type ToolContext } from "@/mcp/tools";
import { aggregate } from "@/lib/collection";
import type { StoredSet } from "@/lib/types";

/** The collection file — same shape the browser stores. */
function loadInventory(path: string | undefined): StoredSet[] {
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as StoredSet[]) : [];
  } catch (err) {
    console.error(
      `[brickbrain] could not read the inventory file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function main() {
  const path = process.argv[2] ?? process.env.BRICKBRAIN_INVENTORY;
  const sets = loadInventory(path);
  const ctx: ToolContext = { pool: aggregate(sets), sets };

  const server = new McpServer({ name: "brickbrain", version: "0.1.0" });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: unknown) => tool.run(args, ctx),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[brickbrain] stdio MCP server ready — ${ctx.pool.size} part/colour combos` +
      (path ? ` from ${path}` : " (no inventory file given)"),
  );
}

void main();
