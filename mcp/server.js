#!/usr/bin/env node

/**
 * Standard Model Context Protocol (MCP) Server for Adobe Firefly Microservice
 * Communicates via JSON-RPC 2.0 over standard I/O (stdio).
 * Compatible with Antigravity, Claude Desktop, Cursor, and any MCP Client.
 */

import readline from "readline";
import fs from "fs";
import path from "path";

const API_BASE = (process.env.FIREFLY_API_URL || "http://localhost:5055").replace(/\/+$/, "");
let API_KEY = process.env.FIREFLY_API_KEY || "";

// Auto-detect master API key from local config if not provided in environment
if (!API_KEY) {
  const localConfig = path.resolve(process.cwd(), "data/config.json");
  if (fs.existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localConfig, "utf8"));
      if (cfg.apiKey) API_KEY = cfg.apiKey;
    } catch (e) {}
  }
}

// Tool Definitions
const TOOLS = [
  {
    name: "firefly_generate_image",
    description: "Generate high-fidelity AI images via Adobe Firefly microservice. Supports GPT Image 2.5 Sunburst (default 5 cr), Firefly Image 4 (0 cr FREE), FLUX, Gemini, and Runway.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed text prompt describing the image to generate."
        },
        model_id: {
          type: "string",
          description: "Model ID. Default is 'gpt-image-2-5-prism' (5 cr). Free options: 'clio-v4-standard', 'clio-v3-standard'. Others: 'flux-2-pro', 'nano-banana-3', 'runway-gen4'."
        },
        aspect: {
          type: "string",
          enum: ["auto", "1:1", "16:9", "9:16", "3:4", "4:3"],
          description: "Aspect ratio. Default is 'auto' (1024x1024)."
        },
        quality: {
          type: "string",
          enum: ["medium", "high"],
          description: "Quality detail level. Default is 'medium' (5 cr). 'high' costs 15 cr."
        },
        reference_images: {
          type: "array",
          items: { type: "string" },
          description: "Up to 4 reference image URLs, local file paths, or asset IDs."
        },
        reference_usage: {
          type: "string",
          enum: ["subject", "style", "structure"],
          description: "How to apply reference image (default: 'subject')."
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "firefly_get_balance",
    description: "Retrieve real-time credit balance and usage from the Adobe Firefly account.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "firefly_get_status",
    description: "Check server status, token expiration countdown, daemon health, and queue load.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "firefly_list_models",
    description: "List all available AI image generation models and their live credit costs.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

async function callApi(endpoint, method = "GET", body = null) {
  const headers = {
    "Accept": "application/json"
  };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const init = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, init);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// JSON-RPC Handlers
async function handleRequest(request) {
  const { id, method, params } = request;

  // Initialize
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "firefly-mcp",
          version: "1.0.0"
        }
      }
    };
  }

  // List Tools
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS
      }
    };
  }

  // Call Tool
  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;

    try {
      if (name === "firefly_generate_image") {
        const payload = {
          prompt: args.prompt,
          modelId: args.model_id || "gpt-image-2-5-prism",
          aspect: args.aspect || "auto",
          quality: args.quality || "medium",
          referenceImages: args.reference_images || [],
          referenceUsage: args.reference_usage || "subject"
        };

        const result = await callApi("/v1/images/generate", "POST", payload);

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  imageUrl: `${API_BASE}${result.imageUrl}`,
                  presignedUrl: result.presignedUrl,
                  localPath: result.imagePath,
                  model: result.model,
                  latencyMs: result.latencyMs
                }, null, 2)
              }
            ]
          }
        };
      }

      if (name === "firefly_get_balance") {
        const balance = await callApi("/v1/credits/balance");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(balance, null, 2) }
            ]
          }
        };
      }

      if (name === "firefly_get_status") {
        const status = await callApi("/api/status");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(status, null, 2) }
            ]
          }
        };
      }

      if (name === "firefly_list_models") {
        const models = await callApi("/v1/models");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              { type: "text", text: JSON.stringify(models, null, 2) }
            ]
          }
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            { type: "text", text: `Error executing ${name}: ${err.message}` }
          ]
        }
      };
    }
  }

  // Unknown method
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  };
}

// Process STDIO Line-by-Line
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    const response = await handleRequest(request);
    process.stdout.write(JSON.stringify(response) + "\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    }) + "\n");
  }
});
