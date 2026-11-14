import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const endpoint = process.env.AGEAF_BOT_ENDPOINT;
const token = process.env.AGEAF_BOT_TOKEN;
if (!endpoint || !token)
  throw new Error("Start this MCP server through an @bot task.");
const server = new McpServer({ name: "ageaf-overleaf", version: "1.0.0" });
const call = async (method: string, args: object) => {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Browser bridge: ${res.status}`);
    const data = (await res.json()) as any;
    if (data.error) throw new Error(data.error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data.result) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: "text" as const, text: String((error as Error).message) },
      ],
    };
  }
};
server.registerTool(
  "overleaf_list_files",
  {
    description: "List files in the current Overleaf project.",
    inputSchema: {},
  },
  () => call("list_files", {})
);
server.registerTool(
  "overleaf_read_selection",
  {
    description:
      "Read active filename and selected text with surrounding context.",
    inputSchema: {},
  },
  () => call("read_selection", {})
);
server.registerTool(
  "overleaf_read_comments",
  {
    description: "Read the comment thread containing the current @bot command.",
    inputSchema: {},
  },
  () => call("read_comments", {})
);
server.registerTool(
  "overleaf_read_file",
  {
    description: "Read a live text file from the current project.",
    inputSchema: { filePath: z.string().min(1) },
  },
  (args) => call("read_file", args)
);
server.registerTool(
  "overleaf_propose_edit",
  {
    description:
      "Stage a replacement and return pending_user_approval; does not write source. filePath identifies a project file. oldText must exactly match current source and be unique within the allowed range, or supply from as its zero-based UTF-16 offset. newText is the replacement and reason explains the edit.",
    inputSchema: {
      filePath: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
      reason: z.string(),
      from: z.number().int().nonnegative().optional(),
    },
  },
  (args) => call("propose_edit", args)
);
await server.connect(new StdioServerTransport());
