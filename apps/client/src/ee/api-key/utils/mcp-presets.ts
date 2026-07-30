export type McpClientPreset = "universal" | "codex" | "vscode" | "claude";

export function getDocmostMcpEndpoint(appUrl: string): string {
  return new URL("/mcp", appUrl).toString().replace(/\/$/, "");
}

export function buildDocmostMcpPresets(endpoint: string, token: string) {
  const vscode = {
    servers: {
      docmost: {
        type: "http",
        url: endpoint,
        headers: {
          Authorization: "Bearer ${input:docmost-mcp-token}",
        },
      },
    },
    inputs: [
      {
        type: "promptString",
        id: "docmost-mcp-token",
        description: "Docmost MCP token",
        password: true,
      },
    ],
  };
  const claude = {
    mcpServers: {
      docmost: {
        command: "npx",
        args: [
          "-y",
          "mcp-remote@0.1.38",
          endpoint,
          "Authorization:${AUTH_HEADER}",
        ],
        env: {
          AUTH_HEADER: `Bearer ${token}`,
        },
      },
    },
  };

  return {
    codex: [
      "[mcp_servers.docmost]",
      `url = ${JSON.stringify(endpoint)}`,
      'bearer_token_env_var = "DOCMOST_MCP_TOKEN"',
    ].join("\n"),
    vscode: JSON.stringify(vscode, null, 2),
    claude: JSON.stringify(claude, null, 2),
  };
}
