/**
 * scripts/mcp-flow.ts — the MCP path, end to end.
 *
 * This is what happens when Claude (in claude.ai, or Claude Code) is pointed
 * at the Brickbrain MCP server. The script plays the part of Claude:
 *
 *   1. connect to the MCP server over stdio
 *   2. ask for the build brief (the user's real parts + the coordinate rules)
 *   3. design a build from those parts
 *   4. validate it (the kernel — the same one the app uses)
 *   5. save it, which pushes it onto the running app's canvas
 *
 * Run: npx tsx scripts/mcp-flow.ts        (the app must be running)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const APP_URL = process.env.BRICKBRAIN_APP_URL ?? "http://localhost:3000";

interface Row {
  partNum: string;
  name: string;
  colorId: number;
  w: number;
  d: number;
  h: number;
}

function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) continue;
    const m = /^(\S+)\s*\|\s*(.+?)\s*\|\s*(\d+)×(\d+)×(\d+)\s*\|\s*(.+?)\s*\(colour id (\d+)\)/.exec(line);
    if (!m) continue;
    rows.push({
      partNum: m[1],
      name: m[2],
      w: Number(m[3]),
      d: Number(m[4]),
      h: Number(m[5]),
      colorId: Number(m[7]),
    });
  }
  return rows;
}

async function call(client: Client, name: string, args: unknown): Promise<string> {
  const result = (await client.callTool({ name, arguments: args as Record<string, unknown> })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  return result.isError ? `ERROR: ${text}` : text;
}

async function main() {
  // 1. connect — exactly how Claude Code / claude.ai launches it
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/stdio.ts"],
    env: { ...process.env, BRICKBRAIN_APP_URL: APP_URL } as Record<string, string>,
  });
  const client = new Client({ name: "mcp-flow-script", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`connected — ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  // 2. the brief
  const brief = await call(client, "get_build_brief", {});
  if (brief.startsWith("ERROR")) {
    console.log(brief);
    console.log("\nIs the app running with a collection? (npm run dev, then add a set)");
    await client.close();
    return;
  }
  const rows = parseRows(brief);
  console.log(`brief: ${rows.length} part/colour rows`);

  const brick = rows.find((r) => r.h === 3) ?? rows[0];
  const plate = rows.find((r) => r.h === 1) ?? brick;
  if (!brick) {
    console.log("no parts to build with");
    await client.close();
    return;
  }
  console.log(`using ${brick.partNum} (${brick.w}×${brick.d}×${brick.h}) and ${plate.partNum} (${plate.w}×${plate.d}×${plate.h})`);

  // 3. design — a little table: a plate top, brick legs, a plate shelf
  const bricks: Array<Record<string, unknown>> = [];
  let id = 1;
  const add = (row: Row, x: number, y: number, z: number) => {
    bricks.push({
      id: `m${id++}`,
      partNum: row.partNum,
      colorId: row.colorId,
      colorName: `colour ${row.colorId}`,
      x,
      y,
      z,
      rot: 0,
    });
  };

  add(plate, 0, 0, 0);
  add(plate, plate.w, 0, 0);
  add(brick, 0, plate.h, 0);
  add(brick, plate.w, plate.h, 0);
  add(plate, 0, plate.h + brick.h, 0);
  add(plate, plate.w, plate.h + brick.h, 0);

  // 4. validate — the kernel
  const verdict = await call(client, "validate_build", { bricks });
  console.log(`validate_build → ${verdict.split("\n")[0]}`);

  if (verdict.startsWith("ok: false")) {
    console.log("the kernel refused it — as it should. Not saving.");
    await client.close();
    return;
  }

  // 5. save — this is what puts the design on the canvas
  const saved = await call(client, "save_build", { name: "MCP Table", bricks });
  console.log(`save_build → ${saved}`);

  // and the app has it
  const res = await fetch(`${APP_URL}/api/designs`);
  const data = (await res.json()) as { design: { name: string; used: number } | null };
  console.log(`the app now holds: ${data.design ? `${data.design.name} (${data.design.used} bricks)` : "nothing"}`);

  await client.close();
}

void main();
