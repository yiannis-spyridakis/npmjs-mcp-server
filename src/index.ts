#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  ListPromptsRequestSchema, // Added
  GetPromptRequestSchema // Added
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';

const encodePackageName = (packageName: string): string => {
  return encodeURIComponent(packageName);
};

interface NpmRegistryPackageInfo {
  name: string;
  'dist-tags': {
    latest: string;
  };
  description?: string;
  time?: {
    [version: string]: string;
  };
  license?: string | { type: string; url?: string };
  homepage?: string;
  repository?: {
    type: string;
    url: string;
  };
  maintainers?: Array<{ name: string; email: string }>;
  keywords?: string[];
}

interface McpSummaryData {
  name: string;
  latestVersion: string;
  description?: string;
  publishDateLatest?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  source: string;
}

interface MaintainerInfo {
  name: string;
  email: string;
}

interface McpDetailsData extends Omit<McpSummaryData, 'source'> {
  // Source will be added by the tool handler
  maintainers?: MaintainerInfo[];
  keywords?: string[];
  source: string;
}

interface McpVersionsData {
  versions: {
    [version: string]: string;
  };
  source: string;
}

interface NpmDownloadsApiResponse {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

interface McpDownloadsData {
  downloads: {
    'last-day'?: number;
    'last-week'?: number;
    'last-month'?: number;
  };
  package: string;
  source: string;
}

// --- Interfaces for npm_audit tool results ---
interface NpmAuditVulnerabilityEntry {
  package: string;
  version: string;
  severity: string;
  advisoryUrl?: string;
}

interface NpmAuditSeveritySummary {
  info?: number;
  low?: number;
  moderate?: number;
  high?: number;
  critical?: number;
  [severity: string]: number | undefined; // For flexibility if npm adds new severities
}

interface NpmAuditOverallSummary {
  totalVulnerabilities: number;
  bySeverity: NpmAuditSeveritySummary;
}

interface McpNpmAuditResult {
  auditRunDate: string;
  npmVersion: string;
  nodeVersion: string;
  summary: NpmAuditOverallSummary;
  vulnerabilities: NpmAuditVulnerabilityEntry[];
  rawAuditReport?: any; // Keep raw report optional and typed as 'any' for now
}

interface RawAuditVulnerabilityValue {
  // Helper for parsing raw audit JSON
  name?: string;
  installed?: string;
  version?: string;
  severity?: string;
  url?: string;
}
// --- End of npm_audit interfaces ---

// --- Interfaces for simulate_npm_audit_fix tool results ---
interface NpmAuditFixAction {
  action: 'add' | 'remove' | 'change' | 'install' | 'update'; // npm uses various terms
  name: string;
  version?: string; // Target version for add/change/update
  oldVersion?: string; // Source version for change/update
  isMajor?: boolean; // Indicates if it's a major version change
  path?: string; // Sometimes included in npm output
}

interface NpmAuditFixSummary {
  added: number;
  removed: number;
  changed: number;
  audited: number;
  funding: number;
}

interface McpSimulateAuditFixResult {
  simulationRunDate: string;
  npmVersion: string;
  nodeVersion: string;
  summary: NpmAuditFixSummary;
  actions: NpmAuditFixAction[];
  // Warnings like ERESOLVE are typically logged to stderr and not in the JSON output
  // We might need a different approach if capturing stderr is required.
  rawSimulationOutput?: any; // Keep raw report optional
}
// --- End of simulate_npm_audit_fix interfaces ---

const NPM_REGISTRY_BASE_URL = 'https://registry.npmjs.org';
const NPM_DOWNLOADS_API_BASE_URL = 'https://api.npmjs.org/downloads/point';

class NpmApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'NpmApiError';
  }
}

const fetchPackageData = async (
  encodedPackageName: string
): Promise<NpmRegistryPackageInfo> => {
  const apiUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
  console.error(
    // Changed to console.error
    `[${new Date().toISOString()}] Fetching package data from: ${apiUrl}`
  );
  try {
    const response = await axios.get<NpmRegistryPackageInfo>(apiUrl);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      if (axiosError.response.status === 404) {
        throw new NpmApiError(
          `Package '${decodeURIComponent(
            encodedPackageName
          )}' not found on npmjs.`,
          404,
          'NPM_PKG_NOT_FOUND'
        );
      }
      throw new NpmApiError(
        `Failed to fetch package data from NPM Registry. Status: ${axiosError.response.status}`,
        axiosError.response.status,
        'NPM_API_ERROR'
      );
    } else if (axiosError.request) {
      throw new NpmApiError(
        'No response received from NPM Registry while fetching package data.',
        undefined,
        'NPM_API_NO_RESPONSE'
      );
    } else {
      throw new NpmApiError(
        `Error fetching package data: ${axiosError.message}`,
        undefined,
        'NPM_API_REQUEST_SETUP_ERROR'
      );
    }
  }
};

const transformDataForSummary = (
  rawData: NpmRegistryPackageInfo,
  sourceUrl: string
): McpSummaryData => {
  const latestVersion = rawData['dist-tags']?.latest;
  let publishDateLatest: string | undefined;
  if (latestVersion && rawData.time && rawData.time[latestVersion]) {
    publishDateLatest = rawData.time[latestVersion];
  }

  let licenseString: string | undefined;
  if (typeof rawData.license === 'string') {
    licenseString = rawData.license;
  } else if (
    rawData.license &&
    typeof rawData.license === 'object' &&
    rawData.license.type
  ) {
    licenseString = rawData.license.type;
  }

  let repositoryUrl: string | undefined;
  if (rawData.repository && rawData.repository.url) {
    repositoryUrl = rawData.repository.url
      .replace(/^git\+/, '')
      .replace(/\.git$/, '');
  }

  return {
    name: rawData.name,
    latestVersion: latestVersion || 'N/A',
    description: rawData.description,
    publishDateLatest: publishDateLatest,
    license: licenseString,
    homepage: rawData.homepage,
    repository: repositoryUrl,
    source: sourceUrl
  };
};

const transformDataForVersions = (
  rawData: NpmRegistryPackageInfo,
  sourceUrl: string
): McpVersionsData => {
  const versionsMap: { [version: string]: string } = {};
  if (rawData.time) {
    for (const key in rawData.time) {
      if (
        Object.prototype.hasOwnProperty.call(rawData.time, key) &&
        /^\d+\.\d+\.\d+([-.].*)?$/.test(key)
      ) {
        versionsMap[key] = rawData.time[key];
      }
    }
  }
  return { versions: versionsMap, source: sourceUrl };
};

const transformDataForDetails = (
  rawData: NpmRegistryPackageInfo,
  sourceUrl: string
): McpDetailsData => {
  const summaryData = transformDataForSummary(rawData, sourceUrl); // Pass sourceUrl here
  const maintainers =
    rawData.maintainers?.map(m => ({ name: m.name, email: m.email })) || [];
  const keywords = rawData.keywords || [];

  return {
    ...summaryData, // summaryData already contains the source
    maintainers: maintainers.length > 0 ? maintainers : undefined,
    keywords: keywords.length > 0 ? keywords : undefined
  };
};

const fetchSinglePeriodDownloads = async (
  period: string,
  encodedPackageName: string
): Promise<number | null> => {
  const apiUrl = `${NPM_DOWNLOADS_API_BASE_URL}/${period}/${encodedPackageName}`;
  console.error(
    // Changed to console.error
    `[${new Date().toISOString()}] Fetching downloads for ${period} from: ${apiUrl}`
  );
  try {
    const response = await axios.get<NpmDownloadsApiResponse>(apiUrl);
    return response.data.downloads;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      `[${new Date().toISOString()}] Failed to fetch downloads for period ${period}, package ${decodeURIComponent(
        encodedPackageName
      )}: ${axiosError.message}`
    );
    return null;
  }
};

const fetchPackageDownloads = async (
  encodedPackageName: string,
  requestedPeriod?: string // Optional specific period
): Promise<McpDownloadsData> => {
  const periodsToFetch = requestedPeriod
    ? [requestedPeriod]
    : ['last-day', 'last-week', 'last-month'];
  const downloadResults: { [period: string]: number | null } = {};

  const downloadPromises = periodsToFetch.map(period =>
    fetchSinglePeriodDownloads(period, encodedPackageName).then(downloads => ({
      period,
      downloads
    }))
  );

  const results = await Promise.allSettled(downloadPromises);

  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value.downloads !== null) {
      downloadResults[result.value.period] = result.value.downloads;
    } else if (
      result.status === 'fulfilled' &&
      result.value.downloads === null
    ) {
      downloadResults[result.value.period] = null; // Explicitly mark as null if API returned null
    }
  });

  const finalDownloads: { [key: string]: number | undefined } = {};
  if (requestedPeriod) {
    if (
      downloadResults[requestedPeriod] !== null &&
      downloadResults[requestedPeriod] !== undefined
    ) {
      finalDownloads[requestedPeriod] = downloadResults[
        requestedPeriod
      ] as number;
    }
  } else {
    if (
      downloadResults['last-day'] !== null &&
      downloadResults['last-day'] !== undefined
    )
      finalDownloads['last-day'] = downloadResults['last-day'] as number;
    if (
      downloadResults['last-week'] !== null &&
      downloadResults['last-week'] !== undefined
    )
      finalDownloads['last-week'] = downloadResults['last-week'] as number;
    if (
      downloadResults['last-month'] !== null &&
      downloadResults['last-month'] !== undefined
    )
      finalDownloads['last-month'] = downloadResults['last-month'] as number;
  }

  return {
    downloads: finalDownloads,
    package: decodeURIComponent(encodedPackageName),
    source: NPM_DOWNLOADS_API_BASE_URL
  };
};

// --- MCP Server Implementation ---

const server = new Server(
  {
    name: 'npmjs-mcp-server',
    version: '1.1.4' // Implement prompt handlers
  },
  {
    capabilities: {
      resources: {}, // No resources defined for now
      tools: {}, // Tools will be added via setRequestHandler
      prompts: {} // Prompts will be added via setRequestHandler
    }
  }
);

// Define prompts separately for handler access
// Add index signature {[key: string]: PromptDefinition | undefined} for type safety
const SERVER_PROMPTS: {
  [key: string]:
    | { name: string; description: string; template: string; inputSchema: any }
    | undefined;
} = {
  'placeholder-prompt': {
    name: 'placeholder-prompt',
    description: 'A placeholder prompt for demonstration purposes.',
    template: 'This is a placeholder template for {{variable}}.',
    inputSchema: {
      type: 'object',
      properties: {
        variable: {
          type: 'string',
          description: 'A placeholder variable.'
        }
      },
      required: ['variable']
    }
  }
};

// --- Zod Schemas for Tool Arguments ---
const PackageNameArgsSchema = z.object({
  packageName: z.string().min(1, 'Package name cannot be empty')
});
type PackageNameArgs = z.infer<typeof PackageNameArgsSchema>;

const PackageDownloadsArgsSchema = z.object({
  packageName: z.string().min(1, 'Package name cannot be empty'),
  period: z.enum(['last-day', 'last-week', 'last-month']).optional()
});
type PackageDownloadsArgs = z.infer<typeof PackageDownloadsArgsSchema>;

// Zod schema for npm_audit arguments
const NpmAuditArgsSchema = z.object({
  projectPath: z.string().min(1, 'Project path cannot be empty')
});
type NpmAuditArgs = z.infer<typeof NpmAuditArgsSchema>;

// Zod schema for simulate_npm_audit_fix arguments
const SimulateNpmAuditFixArgsSchema = z.object({
  projectPath: z.string().min(1, 'Project path cannot be empty')
});
type SimulateNpmAuditFixArgs = z.infer<typeof SimulateNpmAuditFixArgsSchema>;

// Define Input Schemas for tools (as plain objects for SDK)
// No more AnyToolArgsSchema - validation will be per-tool in the handler
const npmAuditInputSchema = {
  type: 'object',
  properties: {
    projectPath: {
      type: 'string',
      description: 'The absolute path to the project directory to audit.'
    }
  },
  required: ['projectPath'],
  additionalProperties: false
};

const simulateNpmAuditFixInputSchema = {
  type: 'object',
  properties: {
    projectPath: {
      type: 'string',
      description:
        'The absolute path to the project directory to simulate `npm audit fix` for.'
    }
  },
  required: ['projectPath'],
  additionalProperties: false
};

const packageNameInputSchema = {
  type: 'object',
  properties: {
    packageName: {
      type: 'string',
      description: 'The name of the npm package (e.g., express, react)'
    }
  },
  required: ['packageName']
};

const packageDownloadsInputSchema = {
  type: 'object',
  properties: {
    packageName: { type: 'string', description: 'The name of the npm package' },
    period: {
      type: 'string',
      description:
        "Optional: 'last-day', 'last-week', 'last-month'. If omitted, all are fetched.",
      enum: ['last-day', 'last-week', 'last-month']
    }
  },
  required: ['packageName']
};

// ListTools Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Cast to 'any' to satisfy ToolDefinition if JSONSchema type is problematic
  const tools: any[] = [
    {
      name: 'get_npm_package_summary',
      description:
        'Provides essential package details: latest version, description, publish date, license, etc.',
      inputSchema: packageNameInputSchema
    },
    {
      name: 'get_npm_package_versions',
      description:
        'Lists available package versions along with their respective publish dates.',
      inputSchema: packageNameInputSchema
    },
    {
      name: 'get_npm_package_downloads',
      description:
        'Provides download statistics for specified or all default periods.',
      inputSchema: packageDownloadsInputSchema
    },
    {
      name: 'get_npm_package_details',
      description:
        'Offers a more comprehensive set of information, including maintainers, repository URL, homepage, and keywords.',
      inputSchema: packageNameInputSchema
    },
    {
      name: 'npm_audit',
      description:
        'Performs an audit of packages in the specified project directory and returns a structured summary of vulnerabilities and metadata',
      inputSchema: npmAuditInputSchema
    },
    {
      name: 'simulate_npm_audit_fix',
      description:
        'Simulates `npm audit fix --dry-run` in the specified project directory and returns a structured summary of potential changes.',
      inputSchema: simulateNpmAuditFixInputSchema
    }
  ];
  return { tools }; // Return only tools here, prompts are handled below
});

// ListPrompts Handler (Corrected)
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  // Return prompts defined in the constant
  return { prompts: Object.values(SERVER_PROMPTS) };
});

// GetPrompt Handler
server.setRequestHandler(GetPromptRequestSchema, async request => {
  const promptName = request.params.name;
  // Access the constant instead of server.capabilities
  const promptDefinition = SERVER_PROMPTS[promptName];

  if (!promptDefinition) {
    throw new Error(`Prompt not found: ${promptName}`);
  }

  // For the placeholder, just return a simple message or empty structure
  // In a real implementation, this would generate the prompt messages based on arguments
  if (promptName === 'placeholder-prompt') {
    return {
      description: promptDefinition.description,
      messages: [
        {
          role: 'system',
          content: {
            type: 'text',
            text: `This is a placeholder prompt named '${promptName}'. It is not fully implemented.`
          }
        }
      ]
      // Alternatively, return an empty messages array:
      // messages: []
    };
  }

  // Handle other prompts if they were implemented
  throw new Error(`Prompt implementation not found for: ${promptName}`);
});

// CallTool Handler
server.setRequestHandler(
  CallToolRequestSchema,
  async (
    request: CallToolRequest
  ): Promise<{
    content: Array<{ type: string; text?: string; data?: any }>;
    isError: boolean;
  }> => {
    const { name: toolName, arguments: args } = request.params;

    // Helper for detailed Zod error logging
    const handleZodError = (
      toolName: string,
      parseResult: z.SafeParseError<any>
    ) => {
      // Production: The thrown error will be sufficient for the client.
      // Detailed server-side logging of Zod issues can be verbose for production.
      // Consider logging `parseResult.error.flatten()` if more detail is needed in server logs without sending full issues to client.
      const errorDetails = JSON.stringify(parseResult.error.issues, null, 2); // Or a more summarized version
      // console.error(`[${new Date().toISOString()}] Zod validation failed for tool ${toolName}: ${errorDetails}`); // Removed for production
      throw new Error(
        `Invalid arguments for tool ${toolName}. Details: ${errorDetails}`
      );
    };

    try {
      let resultData:
        | McpSummaryData
        | McpVersionsData
        | McpDownloadsData
        | McpDetailsData
        | McpNpmAuditResult
        | McpSimulateAuditFixResult; // Added new result type

      switch (toolName) {
        case 'get_npm_package_summary': {
          const parseResult = PackageNameArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          // Now parseResult.success is true, and parseResult.data is defined
          const validatedArgs = parseResult.data!; // Add non-null assertion
          const encodedPackageName = encodePackageName(
            validatedArgs.packageName
          );
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForSummary(rawData, sourceUrl);
          break;
        }
        case 'get_npm_package_versions': {
          const parseResult = PackageNameArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          const validatedArgs = parseResult.data!; // Add non-null assertion
          const encodedPackageName = encodePackageName(
            validatedArgs.packageName
          );
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForVersions(rawData, sourceUrl);
          break;
        }
        case 'get_npm_package_downloads': {
          const parseResult = PackageDownloadsArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          const validatedArgs = parseResult.data!; // Add non-null assertion
          const encodedPackageName = encodePackageName(
            validatedArgs.packageName
          );
          resultData = await fetchPackageDownloads(
            encodedPackageName,
            validatedArgs.period
          );
          break;
        }
        case 'get_npm_package_details': {
          const parseResult = PackageNameArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          const validatedArgs = parseResult.data!; // Add non-null assertion
          const encodedPackageName = encodePackageName(
            validatedArgs.packageName
          );
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForDetails(rawData, sourceUrl);
          break;
        }
        case 'npm_audit': {
          const parseResult = NpmAuditArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          const validatedArgs = parseResult.data!; // Add non-null assertion
          const projectPath = validatedArgs.projectPath;

          // Check for package-lock.json
          const lockfilePath = path.join(projectPath, 'package-lock.json');
          if (!fs.existsSync(lockfilePath)) {
            throw new Error(
              `npm audit requires a package-lock.json file in the target directory '${projectPath}'. Please run 'npm install' or 'npm i --package-lock-only' in that directory first.`
            );
          }

          const { execSync } = await import('child_process');
          let auditRaw: string;
          console.error(
            `[${new Date().toISOString()}] Running npm audit in directory: ${projectPath}`
          );
          try {
            auditRaw = execSync('npm audit --json', {
              encoding: 'utf-8',
              cwd: projectPath // Execute in the specified project directory
            });
          } catch (err: any) {
            // npm audit returns non-zero exit code if vulnerabilities are found, but still outputs JSON
            if (err.stdout) {
              auditRaw = err.stdout;
            } else {
              throw new Error(
                `Failed to run 'npm audit --json' in ${projectPath}: ${
                  err.message || err
                }`
              );
            }
          }
          let auditJson: any;
          try {
            auditJson = JSON.parse(auditRaw);
          } catch (err) {
            throw new Error(
              `Failed to parse npm audit JSON output from ${projectPath}.`
            );
          }

          // Summarize vulnerabilities
          const rawSeveritySummary = (auditJson.metadata?.vulnerabilities ||
            {}) as NpmAuditSeveritySummary;
          const summary: NpmAuditOverallSummary = {
            totalVulnerabilities: Object.values(rawSeveritySummary).reduce(
              (acc: number, count?: number) => acc + (count || 0),
              0
            ),
            bySeverity: rawSeveritySummary
          };

          const vulnerabilities: NpmAuditVulnerabilityEntry[] = [];
          if (auditJson.vulnerabilities) {
            for (const [
              pkgName,
              vulnDetails
            ] of Object.entries<RawAuditVulnerabilityValue>(
              auditJson.vulnerabilities as Record<
                string,
                RawAuditVulnerabilityValue
              >
            )) {
              vulnerabilities.push({
                package: pkgName, // Use the key as package name
                version: vulnDetails.installed || vulnDetails.version || '',
                severity: vulnDetails.severity || 'unknown',
                advisoryUrl: vulnDetails.url || undefined
              });
            }
          }

          resultData = {
            auditRunDate:
              auditJson.metadata?.auditReportCreatedAt ||
              new Date().toISOString(),
            npmVersion: auditJson.metadata?.npmVersion || '',
            nodeVersion: auditJson.metadata?.nodeVersion || '',
            summary,
            vulnerabilities,
            rawAuditReport: auditJson
          } as McpNpmAuditResult;
          break;
        }
        case 'simulate_npm_audit_fix': {
          const parseResult = SimulateNpmAuditFixArgsSchema.safeParse(args);
          if (!parseResult.success) {
            handleZodError(toolName, parseResult);
          }
          const validatedArgs = parseResult.data!;
          const projectPath = validatedArgs.projectPath;

          // Check for package-lock.json
          const lockfilePath = path.join(projectPath, 'package-lock.json');
          if (!fs.existsSync(lockfilePath)) {
            throw new Error(
              `npm audit fix requires a package-lock.json file in the target directory '${projectPath}'. Please run 'npm install' or 'npm i --package-lock-only' in that directory first.`
            );
          }

          const { execSync } = await import('child_process');
          let simulationRaw: string;
          console.error(
            `[${new Date().toISOString()}] Running npm audit fix --dry-run --json in directory: ${projectPath}`
          );
          try {
            // Use --json flag for structured output
            simulationRaw = execSync('npm audit fix --dry-run --json', {
              encoding: 'utf-8',
              cwd: projectPath, // Execute in the specified project directory
              stdio: ['pipe', 'pipe', 'pipe'] // Capture stdout, stderr
            });
          } catch (err: any) {
            // npm audit fix --dry-run might exit non-zero even if it produces JSON
            if (err.stdout) {
              simulationRaw = err.stdout;
              console.error(
                `[${new Date().toISOString()}] npm audit fix --dry-run exited non-zero but produced output in ${projectPath}. Stderr: ${
                  err.stderr || '(no stderr)'
                }`
              );
            } else {
              throw new Error(
                `Failed to run 'npm audit fix --dry-run --json' in ${projectPath}: ${
                  err.message || err
                }. Stderr: ${err.stderr || '(no stderr)'}`
              );
            }
          }

          let simulationJson: any;
          try {
            // Find the start of the JSON object
            const jsonStartIndex = simulationRaw.indexOf('{');
            if (jsonStartIndex === -1) {
              throw new Error(
                `Could not find start of JSON object in npm audit fix --dry-run output from ${projectPath}. Raw output: ${simulationRaw}`
              );
            }
            const jsonString = simulationRaw.substring(jsonStartIndex);
            simulationJson = JSON.parse(jsonString);
          } catch (err) {
            throw new Error(
              `Failed to parse npm audit fix --dry-run JSON output from ${projectPath}. Error: ${
                (err as Error).message
              }. Raw output fragment: ${simulationRaw.substring(0, 500)}...` // Include fragment
            );
          }

          // Parse the JSON output - structure based on observed npm behavior
          let actions: NpmAuditFixAction[] = [];
          if (simulationJson.actions && Array.isArray(simulationJson.actions)) {
            actions = simulationJson.actions.map((action: any) => {
              // Defensive parsing for action properties
              const actionType =
                typeof action.action === 'string'
                  ? action.action.toLowerCase()
                  : 'unknown';
              const name =
                typeof action.module === 'string'
                  ? action.module
                  : typeof action.name === 'string'
                  ? action.name
                  : 'unknown';
              const version =
                typeof action.target === 'string' ? action.target : undefined;
              let oldVersion: string | undefined;
              if (
                action.resolves &&
                Array.isArray(action.resolves) &&
                action.resolves.length > 0 &&
                action.resolves[0]
              ) {
                oldVersion =
                  typeof action.resolves[0].from === 'string'
                    ? action.resolves[0].from
                    : undefined;
              }
              const isMajor =
                typeof action.isMajor === 'boolean'
                  ? action.isMajor
                  : undefined;
              let path: string | undefined;
              if (
                action.resolves &&
                Array.isArray(action.resolves) &&
                action.resolves.length > 0 &&
                action.resolves[0]
              ) {
                path =
                  typeof action.resolves[0].path === 'string'
                    ? action.resolves[0].path
                    : undefined;
              }

              return {
                action: actionType as NpmAuditFixAction['action'], // Cast, assuming valid types after check
                name,
                version,
                oldVersion,
                isMajor,
                path
              };
            });
          }

          const summary: NpmAuditFixSummary = {
            added: simulationJson.added || 0,
            removed: simulationJson.removed || 0,
            changed: simulationJson.changed || 0,
            audited: simulationJson.audited || 0,
            funding: simulationJson.funding || 0
          };

          resultData = {
            simulationRunDate: new Date().toISOString(), // No reliable timestamp in output
            npmVersion: simulationJson.metadata?.npmVersion || '', // Attempt to get metadata
            nodeVersion: simulationJson.metadata?.nodeVersion || '',
            summary,
            actions,
            rawSimulationOutput: simulationJson // Include raw for debugging
          } as McpSimulateAuditFixResult;
          break;
        }
        default:
          throw new Error(`Tool '${toolName}' not found or not implemented.`);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(resultData) }],
        isError: false
      };
    } catch (error) {
      if (error instanceof NpmApiError) {
        // Re-throw with a simple message; SDK handles formatting
        // NpmApiError messages often include package name or relevant context.
        // validatedArgs is not in scope here, so we log toolName and the error's own message.
        console.error(
          `[${new Date().toISOString()}] NpmApiError in tool ${toolName}: ${
            error.message
          } (Code: ${error.code}, Status: ${error.statusCode})`
        );
        throw new Error(error.message);
      }
      // Log other errors - validatedArgs is not in scope here, log toolName only
      console.error(
        `[${new Date().toISOString()}] Unknown error in tool ${toolName}: ${
          (error as Error).message
        }`
      );
      throw error; // Re-throw other errors
    }
  }
);

async function main() {
  console.error(`[${new Date().toISOString()}] Starting NPMJS MCP Server...`); // Changed to console.error
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    // Changed to console.error
    `[${new Date().toISOString()}] NPMJS MCP Server connected and listening via StdioTransport.`
  );
}

main().catch(error => {
  console.error(`[${new Date().toISOString()}] Fatal error in main():`, error);
  process.exit(1);
});
