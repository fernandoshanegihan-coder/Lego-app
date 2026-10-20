/**
 * mcp/server.ts — one request, one conversation. `spec.md > Components > mcp/server.ts`.
 *
 * An `McpServer` over an `InMemoryTransport` pair, bound to a single request's
 * inventory. The chat route creates one per conversation and discards it —
 * no collection is ever retained between requests. That statelessness is what
 * keeps the server stateless.
 *
 * The tool definitions the Anthropic call uses come from THIS server via
 * listTools(), so there is exactly one description of each tool in the
 * codebase — here and nowhere else.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOLS, type ToolContext, type AnthropicTool } from "@/mcp/tools";

export interface ChatMcp {
  /** A connected client for the loop — `client.callTool(...)` is all it uses. */
  client: Client;
  /** Tool schemas as returned by listTools(), converted for the Anthropic call. */
  anthropicTools: AnthropicTool[];
  /** Closes both transports. Nothing survives the request. */
  close: () => Promise<void>;
}

export async function createChatMcp(ctx: ToolContext): Promise<ChatMcp> {
  const server = new McpServer({ name: "brickbrain", version: "0.1.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: unknown) => tool.run(args, ctx),
    );
  }

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "brickbrain-loop", version: "0.1.0" });
  await client.connect(clientTransport);

  const listed = await client.listTools();
  // The MCP server is the source of truth; this conversion is 1:1.
  const anthropicTools: AnthropicTool[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as unknown as { type: "object" } & Record<string, unknown>,
  }));

  const close = async () => {
    await client.close();
    await server.close();
  };

  return { client, anthropicTools, close };
}
