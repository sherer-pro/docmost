import { describe, expect, it } from "vitest";
import { buildDocmostMcpPresets, getDocmostMcpEndpoint } from "./mcp-presets";

describe("Docmost MCP presets", () => {
  const token = "one-time-secret";
  const endpoint = getDocmostMcpEndpoint("https://docs.example.test/base");
  const presets = buildDocmostMcpPresets(endpoint, token);

  it("builds the canonical MCP endpoint", () => {
    expect(endpoint).toBe("https://docs.example.test/mcp");
    expect(endpoint.endsWith("/mcp")).toBe(true);
  });

  it("builds Codex TOML without embedding the token", () => {
    expect(presets.codex).toContain("[mcp_servers.docmost]");
    expect(presets.codex).toContain(
      'bearer_token_env_var = "DOCMOST_MCP_TOKEN"',
    );
    expect(presets.codex).not.toContain(token);
  });

  it("builds valid VS Code and Claude JSON presets", () => {
    const vscode = JSON.parse(presets.vscode);
    const claude = JSON.parse(presets.claude);

    expect(vscode.servers.docmost).toMatchObject({
      type: "http",
      url: endpoint,
    });
    expect(vscode.inputs[0].password).toBe(true);
    expect(presets.vscode).not.toContain(token);
    expect(claude.mcpServers.docmost.args).toContain("mcp-remote@0.1.38");
    expect(claude.mcpServers.docmost.env.AUTH_HEADER).toBe(`Bearer ${token}`);
  });
});
