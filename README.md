# NPMJS Model Context Protocol (MCP) Server

## 1. Project Purpose

The primary objective of this project is to create a lightweight, TypeScript-based Model Context Protocol (MCP) server. This server is dedicated to providing structured information about npmjs packages—such as version details, download statistics, publish dates, descriptions, and licenses—in a simple, standardized JSON format. This format is suitable for consumption by Large Language Models (LLMs) and AI-driven development tools.

The server aims to simplify access to npm package metadata by abstracting away direct interactions with multiple npmjs API endpoints.

## 2. Setup Instructions

1.  **Clone the repository (if applicable):**
    ```bash
    git clone <repository-url>
    cd npmjs-mcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## 3. Running the Server

### Development Environment

To run the server in a development environment with automatic restarts on file changes:

```bash
npm run dev
```

The server will start and listen for MCP requests via standard input/output.

### Building for Production

To compile the TypeScript code to JavaScript for production:

```bash
npm run build
```

This will create a `dist` directory with the compiled files.

### Production Environment

To run the compiled server in a production environment:

```bash
npm start
```

## 4. Available MCP Tools

This server provides tools that can be called using an MCP client.

### Tool: `get_npm_package_summary`

- **Description:** Provides essential package details: name, latest version, description, publish date of the latest version, license, homepage, and repository URL.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "packageName": {
        "type": "string",
        "description": "The name of the npm package (e.g., 'express', 'react')"
      }
    },
    "required": ["packageName"]
  }
  ```

### Tool: `get_npm_package_versions`

- **Description:** Lists all available package versions along with their respective publish dates.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "packageName": {
        "type": "string",
        "description": "The name of the npm package"
      }
    },
    "required": ["packageName"]
  }
  ```

### Tool: `get_npm_package_downloads`

- **Description:** Provides download statistics. Can fetch for a specific period or all default periods (`last-day`, `last-week`, `last-month`) if `period` is omitted.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "packageName": {
        "type": "string",
        "description": "The name of the npm package"
      },
      "period": {
        "type": "string",
        "description": "Optional: 'last-day', 'last-week', 'last-month'. If omitted, all are fetched.",
        "enum": ["last-day", "last-week", "last-month"]
      }
    },
    "required": ["packageName"]
  }
  ```

### Tool: `get_npm_package_details`

- **Description:** Offers a comprehensive set of information including summary details plus maintainers and keywords.
- **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "packageName": {
        "type": "string",
        "description": "The name of the npm package"
      }
    },
    "required": ["packageName"]
  }
  ```

## 5. Example Tool Usage and Responses

The following examples illustrate how to call a tool (conceptual, actual client usage may vary) and the expected `data` portion of the successful MCP `CallToolResponse`. The MCP SDK handles the full response envelope (version, timestamp, etc.).

### Example: Calling `get_npm_package_summary`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected `data` in MCP Response:**

```json
{
{
  "name": "express",
  "latestVersion": "5.1.0",
  "description": "Fast, unopinionated, minimalist web framework",
  "publishDateLatest": "2025-03-31T14:01:22.509Z",
  "license": "MIT",
  "homepage": "http://expressjs.com/",
  "repository": "https://github.com/expressjs/express",
  "source": "https://registry.npmjs.org/express"
}
```

### Example: Calling `get_npm_package_versions`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected `data` in MCP Response:**

```json
{
  "versions": {
    "1.0.0": "2010-12-29T19:38:25.450Z",
    "1.0.1": "2010-12-29T19:38:25.450Z",
    "4.19.2": "2024-03-25T14:30:36.103Z",
    "5.1.0": "2025-03-31T14:01:22.509Z"
    // ... potentially many more versions
  },
  "source": "https://registry.npmjs.org/express"
}
```

### Example: Calling `get_npm_package_downloads` (all default periods)

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected `data` in MCP Response:**

```json
{
  "downloads": {
    "last-day": 7895822,
    "last-week": 37439130,
    "last-month": 162348160
  },
  "package": "express",
  "source": "https://api.npmjs.org/downloads/point"
}
```

### Example: Calling `get_npm_package_details`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected `data` in MCP Response:**

```json
{
{
  "name": "express",
  "latestVersion": "5.1.0",
  "description": "Fast, unopinionated, minimalist web framework",
  "publishDateLatest": "2025-03-31T14:01:22.509Z",
  "license": "MIT",
  "homepage": "https://expressjs.com/",
  "repository": "https://github.com/expressjs/express",
  "maintainers": [
    { "name": "wesleytodd", "email": "wes@wesleytodd.com" },
    { "name": "jonchurch", "email": "npm@jonchurch.com" }
  ],
  "keywords": [
    "express",
    "framework",
    "web"
  ],
  "source": "https://registry.npmjs.org/express"
}
```

### Error Handling

If a tool call fails (e.g., package not found, invalid arguments), the MCP server will return a standard MCP error response. The `error` object within this response will contain a `message` detailing the issue.

**Example MCP Error Response (conceptual):**

```json
{
  "version": "0.2.0", // SDK version
  "id": "response-id",
  "type": "CallToolResponse",
  "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "result": {
    "error": {
      "type": "ToolError", // Or similar error type from SDK
      "message": "Package 'nonexistent-pkg' not found on npmjs."
      // Potentially other fields like 'toolName'
    }
  }
}
```

If a required argument like `packageName` is missing, the tool handler will throw an error, resulting in a similar MCP error response.
