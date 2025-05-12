# NPMJS Model Context Protocol (MCP) Server (v1.1.5)

## 1. Project Purpose

The primary objective of this project is to create a lightweight, TypeScript-based Model Context Protocol (MCP) server. This server is dedicated to providing structured information about npmjs packages—such as version details, download statistics, publish dates, descriptions, and licenses—in a simple, standardized JSON format. This format is suitable for consumption by Large Language Models (LLMs) and AI-driven development tools.

The server aims to simplify access to npm package metadata by abstracting away direct interactions with multiple npmjs API endpoints.

## 2. Setup Instructions

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yiannis-spyridakis/npmjs-mcp-server.git
    cd npmjs-mcp-server
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## 3. Running the Server

This MCP server is designed to be run as a child process by an MCP client (like an LLM agent or a development tool). It communicates with the client over standard input (stdin) and standard output (stdout) using the Model Context Protocol.

### Development Environment

To run the server directly for development purposes, with automatic restarts on file changes:

```bash
npm run dev
```

Alternatively, for a single run without watching for changes:

```bash
npm run watch
```

(Note: `npm run watch` uses `nodemon` and `ts-node` as specified in `package.json` for development. `npm run dev` uses `ts-node` directly.)

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

This command executes `node dist/index.js`. The MCP client is responsible for launching this command as a child process.

## 4. Available MCP Tools

This server provides tools that can be called using an MCP client.

### Tool: `get_npm_package_summary`

- **Description:** Provides essential package details: name, latest version, description, publish date of the latest version, license, homepage, and repository URL (if available).
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

## 5. Available MCP Prompts

In addition to tools, this server provides prompts that can be used by an MCP client to generate specific user requests based on provided variables, simplifying common interactions.

### Prompt: `get_summary_prompt`

- **Description:** Generates a request to get a quick summary of a specified npm package.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    }
  }
  ```

### Prompt: `get_details_prompt`

- **Description:** Generates a request for full details of a specified npm package, including maintainers and repository URL.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    }
  }
  ```

### Prompt: `find_homepage_prompt`

- **Description:** Generates a request to find the official homepage for a specified npm package.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    }
  }
  ```

### Prompt: `list_versions_prompt`

- **Description:** Generates a request to list all available versions and their publish dates for a specified npm package.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    }
  }
  ```

### Prompt: `get_version_date_prompt`

- **Description:** Generates a request to find the publish date for a specific version of a specified npm package.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    },
    "version": {
      "type": "string",
      "description": "The specific version string (e.g., '16.8.0')"
    }
  }
  ```

### Prompt: `get_downloads_prompt`

- **Description:** Generates a request for the download count of a specified npm package over a specific time period.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    },
    "timePeriod": {
      "type": "string",
      "enum": ["last-day", "last-week", "last-month"],
      "description": "The time period for download counts"
    }
  }
  ```

### Prompt: `get_all_downloads_prompt`

- **Description:** Generates a request for the download counts of a specified npm package for the last day, week, and month.
- **Input Schema:**
  ```json
  {
    "packageName": {
      "type": "string",
      "description": "The name of the npm package"
    }
  }
  ```

### Prompt: `audit_project_prompt`

- **Description:** Generates a request to audit the dependencies in a specified project directory for security vulnerabilities.
- **Input Schema:**
  ```json
  {
    "projectPath": {
      "type": "string",
      "description": "The path to the project directory (e.g., '.', '../my-app')"
    }
  }
  ```

### Prompt: `simulate_audit_fix_prompt`

- **Description:** Generates a request to simulate running `npm audit fix` on a specified project directory.
- **Input Schema:**
  ```json
  {
    "projectPath": {
      "type": "string",
      "description": "The path to the project directory (e.g., '.', '../my-app')"
    }
  }
  ```

## 6. Example Tool Usage and Responses

The following examples illustrate how to call a tool (conceptual, actual client usage may vary) and the expected `data` portion of the successful MCP `CallToolResponse`. The MCP SDK handles the full response envelope (version, timestamp, etc.). The `data` field in the MCP response will contain a `content` array, where the first element is an object of type `text` and its `text` property holds a JSON string of the results shown below.

### Example: Calling `get_npm_package_summary`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected JSON string in `data.content[0].text`:**

```json
{
  "name": "express",
  "latestVersion": "4.19.2",
  "description": "Fast, unopinionated, minimalist web framework for node.",
  "publishDateLatest": "2024-03-25T14:30:36.103Z",
  "license": "MIT",
  "homepage": "http://expressjs.com/",
  "repository": "https://github.com/expressjs/express",
  "source": "https://registry.npmjs.org/express"
}
```

_(Note: Version and date are examples and will reflect actual data at the time of query)_

### Example: Calling `get_npm_package_versions`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected JSON string in `data.content[0].text`:**

```json
{
  "versions": {
    "1.0.0": "2010-12-29T19:38:25.450Z",
    "1.0.1": "2010-12-29T19:38:25.450Z",
    "4.19.2": "2024-03-25T14:30:36.103Z"
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

**Expected JSON string in `data.content[0].text`:**

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

_(Note: Download counts are examples and will reflect actual data at the time of query)_

### Example: Calling `get_npm_package_details`

**Tool Call Arguments:**

```json
{
  "packageName": "express"
}
```

**Expected JSON string in `data.content[0].text`:**

```json
{
  "name": "express",
  "latestVersion": "4.19.2",
  "description": "Fast, unopinionated, minimalist web framework for node.",
  "publishDateLatest": "2024-03-25T14:30:36.103Z",
  "license": "MIT",
  "homepage": "https://expressjs.com/",
  "repository": "https://github.com/expressjs/express",
  "maintainers": [
    { "name": "dougwilson", "email": "doug@somethingdoug.com" },
    { "name": "wesleytodd", "email": "wes@wesleytodd.com" }
    // ... other maintainers
  ],
  "keywords": [
    "express",
    "framework",
    "sinatra",
    "web",
    "rest",
    "restful",
    "router"
  ],
  "source": "https://registry.npmjs.org/express"
}
```

_(Note: Version, date, maintainers, and keywords are examples and will reflect actual data at the time of query)_

### Error Handling

If a tool call fails (e.g., package not found, invalid arguments), the MCP server will return a standard MCP error response. The `result.error` object within this response will contain a `message` detailing the issue.

**Example MCP Error Response (conceptual structure):**

```json
{
  "version": "0.2.0", // SDK version
  "id": "response-id-string",
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

## 7. Example Prompt Usage

The following examples show how to use the available prompts by providing arguments. The server will return a `GetPromptResponse` containing the generated user message.

### Example: Using `get_summary_prompt`

**Prompt Call Arguments:**

```json
{ "packageName": "react" }
```

**Generated User Message (`messages[0].content.text`):**

```
Get a quick summary of the 'react' npm package.
```

### Example: Using `get_version_date_prompt`

**Prompt Call Arguments:**

```json
{ "packageName": "lodash", "version": "4.17.21" }
```

**Generated User Message (`messages[0].content.text`):**

```
What was the publish date of version 4.17.21 for 'lodash'?
```

### Example: Using `get_downloads_prompt`

**Prompt Call Arguments:**

```json
{ "packageName": "axios", "timePeriod": "last-week" }
```

**Generated User Message (`messages[0].content.text`):**

```
How many times was 'axios' downloaded in the last-week?
```

### Example: Using `audit_project_prompt`

**Prompt Call Arguments:**

```json
{ "projectPath": "../my-frontend-app" }
```

**Generated User Message (`messages[0].content.text`):**

```
Audit the dependencies in the project at '../my-frontend-app' for security vulnerabilities.
```

### Example: Using `simulate_audit_fix_prompt`

**Prompt Call Arguments:**

```json
{ "projectPath": "." }
```

**Generated User Message (`messages[0].content.text`):**

```
Simulate running 'npm audit fix' on the project at '.' and show me what would change.
```
