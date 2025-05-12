# LLMs Installation Guide for npmjs-mcp-server

This guide provides specific instructions for AI agents like Cline to install and configure the `npmjs-mcp-server`.

## Prerequisites

- Node.js (which includes npm) must be installed and accessible in the system's PATH.

## Installation Steps

1.  **Clone the Repository:**
    Clone the server's repository to a local directory.

    ```bash
    git clone https://github.com/yiannis-spyridakis/npmjs-mcp-server.git <target-directory>
    cd <target-directory>
    ```

    _(Replace `<target-directory>` with the desired installation path, e.g., `/path/to/mcp-servers/npmjs-mcp-server`)_

2.  **Install Dependencies:**
    Navigate into the cloned directory (`<target-directory>`) and run:

    ```bash
    npm install
    ```

3.  **Build the Project:**
    Compile the TypeScript source code:
    ```bash
    npm run build
    ```
    _(This creates the necessary JavaScript files in the `dist/` directory)_

## Cline Configuration

To add this server to Cline, use the "Configure MCP Servers" interface or directly edit the `cline_mcp_settings.json` file. Add the following configuration block within the `mcpServers` object. Ensure you adjust the path in `args` if you cloned the repository to a location different from where Cline executes commands, although typically Cline executes from the cloned directory root itself.

```json
{
  "mcpServers": {
    "npmjs-mcp-server": {
      "name": "npmjs-mcp-server", // Or a preferred display name like "NPM Tools"
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"], // Path relative to the root of the cloned repository
      "enabled": true // Ensure the server is enabled
    }
    // ... other server configurations ...
  }
}
```

**Important Configuration Notes:**

- **`name`**: A unique identifier for Cline (e.g., "Npm").
- **`type`**: Must be `"stdio"`.
- **`command`**: Must be `"node"`. Do **not** use `npx` or global package names here.
- **`args`**: Must be an array containing the path to the built entry point, `["dist/index.js"]`. This path is relative to the root directory of the cloned repository (`<target-directory>`).
- **`enabled`**: Set to `true` to activate the server upon Cline startup or MCP reload.

## Verification

After adding the configuration and restarting/reloading MCP servers in Cline:

1.  Check the "MCP Servers" list in Cline to ensure "npmjs-mcp-server" (or your chosen name) appears and is enabled without errors.
2.  Verify that the server's tools and prompts are listed when requested (e.g., via a `tools/list` or `prompts/list` request, or by asking Cline what tools the server provides).
3.  Test a specific tool or prompt, for example:

    ```
    <use_mcp_tool>
    <server_name>npmjs-mcp-server</server_name>
    <tool_name>get_npm_package_summary</tool_name>
    <arguments>
    {
      "packageName": "react"
    }
    </arguments>
    </use_mcp_tool>
    ```

Successful execution confirms the server is installed and configured correctly.
