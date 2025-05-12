#!/usr/bin/env node
import { McpServer as Server } from '@modelcontextprotocol/sdk/server/mcp.js'; // Changed import
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolResult, // Needed for tool handlers
  GetPromptResult // Needed for prompt handlers
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
  [severity: string]: number | undefined;
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
  rawAuditReport?: any;
}

interface RawAuditVulnerabilityValue {
  name?: string;
  installed?: string;
  version?: string;
  severity?: string;
  url?: string;
}

interface NpmAuditFixAction {
  action: 'add' | 'remove' | 'change' | 'install' | 'update';
  name: string;
  version?: string;
  oldVersion?: string;
  isMajor?: boolean;
  path?: string;
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
  rawSimulationOutput?: any;
}

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
  const summaryData = transformDataForSummary(rawData, sourceUrl);
  const maintainers =
    rawData.maintainers?.map(m => ({ name: m.name, email: m.email })) || [];
  const keywords = rawData.keywords || [];
  return {
    ...summaryData,
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
  requestedPeriod?: string
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
      downloadResults[result.value.period] = null;
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
    version: '1.1.5' // Refactored to use server.tool() and server.prompt()
  },
  {
    capabilities: {
      // Tools and Prompts will be defined using server.tool() and server.prompt()
      resources: {},
      tools: {},
      prompts: {}
    }
  }
);

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

const NpmAuditArgsSchema = z.object({
  projectPath: z.string().min(1, 'Project path cannot be empty')
});
type NpmAuditArgs = z.infer<typeof NpmAuditArgsSchema>;

const SimulateNpmAuditFixArgsSchema = z.object({
  projectPath: z.string().min(1, 'Project path cannot be empty')
});
type SimulateNpmAuditFixArgs = z.infer<typeof SimulateNpmAuditFixArgsSchema>;

// --- Zod Schemas for Prompt Arguments ---
// Reusing PackageNameArgsSchema for prompts needing only packageName
// Reusing NpmAuditArgsSchema for prompts needing only projectPath
// Reusing SimulateNpmAuditFixArgsSchema for prompts needing only projectPath

const GetVersionDateArgsSchema = z.object({
  packageName: z.string().min(1, 'Package name cannot be empty'),
  version: z.string().min(1, 'Version cannot be empty') // Basic validation, could be stricter regex
});
type GetVersionDateArgs = z.infer<typeof GetVersionDateArgsSchema>;

const GetDownloadsArgsSchema = z.object({
  packageName: z.string().min(1, 'Package name cannot be empty'),
  timePeriod: z.enum(['last-day', 'last-week', 'last-month'])
});
type GetDownloadsArgs = z.infer<typeof GetDownloadsArgsSchema>;

// --- Tool Implementations ---

server.tool(
  'get_npm_package_summary',
  'Provides essential package details: latest version, description, publish date, license, etc.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<CallToolResult> => {
    try {
      const encodedPackageName = encodePackageName(args.packageName);
      const rawData = await fetchPackageData(encodedPackageName);
      const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
      const resultData = transformDataForSummary(rawData, sourceUrl);
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(
        `Error in get_npm_package_summary: ${(error as Error).message}`
      );
      throw error; // Re-throw for SDK to handle
    }
  }
);

server.tool(
  'get_npm_package_versions',
  'Lists available package versions along with their respective publish dates.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<CallToolResult> => {
    try {
      const encodedPackageName = encodePackageName(args.packageName);
      const rawData = await fetchPackageData(encodedPackageName);
      const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
      const resultData = transformDataForVersions(rawData, sourceUrl);
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(
        `Error in get_npm_package_versions: ${(error as Error).message}`
      );
      throw error;
    }
  }
);

server.tool(
  'get_npm_package_downloads',
  'Provides download statistics for specified or all default periods.',
  PackageDownloadsArgsSchema.shape,
  async (args: PackageDownloadsArgs): Promise<CallToolResult> => {
    try {
      const encodedPackageName = encodePackageName(args.packageName);
      const resultData = await fetchPackageDownloads(
        encodedPackageName,
        args.period
      );
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(
        `Error in get_npm_package_downloads: ${(error as Error).message}`
      );
      throw error;
    }
  }
);

server.tool(
  'get_npm_package_details',
  'Offers a more comprehensive set of information, including maintainers, repository URL, homepage, and keywords.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<CallToolResult> => {
    try {
      const encodedPackageName = encodePackageName(args.packageName);
      const rawData = await fetchPackageData(encodedPackageName);
      const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
      const resultData = transformDataForDetails(rawData, sourceUrl);
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(
        `Error in get_npm_package_details: ${(error as Error).message}`
      );
      throw error;
    }
  }
);

server.tool(
  'npm_audit',
  'Performs an audit of packages in the specified project directory and returns a structured summary of vulnerabilities and metadata',
  NpmAuditArgsSchema.shape,
  async (args: NpmAuditArgs): Promise<CallToolResult> => {
    try {
      const projectPath = args.projectPath;
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
          cwd: projectPath
        });
      } catch (err: any) {
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
            package: pkgName,
            version: vulnDetails.installed || vulnDetails.version || '',
            severity: vulnDetails.severity || 'unknown',
            advisoryUrl: vulnDetails.url || undefined
          });
        }
      }
      const resultData: McpNpmAuditResult = {
        auditRunDate:
          auditJson.metadata?.auditReportCreatedAt || new Date().toISOString(),
        npmVersion: auditJson.metadata?.npmVersion || '',
        nodeVersion: auditJson.metadata?.nodeVersion || '',
        summary,
        vulnerabilities,
        rawAuditReport: auditJson
      };
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(`Error in npm_audit: ${(error as Error).message}`);
      throw error;
    }
  }
);

server.tool(
  'simulate_npm_audit_fix',
  'Simulates `npm audit fix --dry-run` in the specified project directory and returns a structured summary of potential changes.',
  SimulateNpmAuditFixArgsSchema.shape,
  async (args: SimulateNpmAuditFixArgs): Promise<CallToolResult> => {
    try {
      const projectPath = args.projectPath;
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
        simulationRaw = execSync('npm audit fix --dry-run --json', {
          encoding: 'utf-8',
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (err: any) {
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
          }. Raw output fragment: ${simulationRaw.substring(0, 500)}...`
        );
      }
      let actions: NpmAuditFixAction[] = [];
      if (simulationJson.actions && Array.isArray(simulationJson.actions)) {
        actions = simulationJson.actions.map((action: any) => {
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
            typeof action.isMajor === 'boolean' ? action.isMajor : undefined;
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
            action: actionType as NpmAuditFixAction['action'],
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
      const resultData: McpSimulateAuditFixResult = {
        simulationRunDate: new Date().toISOString(),
        npmVersion: simulationJson.metadata?.npmVersion || '',
        nodeVersion: simulationJson.metadata?.nodeVersion || '',
        summary,
        actions,
        rawSimulationOutput: simulationJson
      };
      return { content: [{ type: 'text', text: JSON.stringify(resultData) }] };
    } catch (error) {
      console.error(
        `Error in simulate_npm_audit_fix: ${(error as Error).message}`
      );
      throw error;
    }
  }
);

// --- Prompt Implementations ---

// 1. Get Summary Prompt
server.prompt(
  'get_summary_prompt',
  'Generates a request to get a quick summary of a specified npm package.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request to get a quick summary of the '${args.packageName}' npm package.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Get a quick summary of the '${args.packageName}' npm package.`
          }
        }
      ]
    };
  }
);

// 2. Get Details Prompt
server.prompt(
  'get_details_prompt',
  'Generates a request for full details of a specified npm package, including maintainers and repository URL.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request for full details of the '${args.packageName}' package.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Show me the full details for '${args.packageName}', including its repository URL and maintainers.`
          }
        }
      ]
    };
  }
);

// 3. Find Homepage Prompt
server.prompt(
  'find_homepage_prompt',
  'Generates a request to find the official homepage for a specified npm package.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request to find the official homepage for the '${args.packageName}' package.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `What is the official homepage for the '${args.packageName}' package?`
          }
        }
      ]
    };
  }
);

// 4. List Versions Prompt
server.prompt(
  'list_versions_prompt',
  'Generates a request to list all available versions and their publish dates for a specified npm package.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request to list versions for the '${args.packageName}' package.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `List all available versions of '${args.packageName}' and their publish dates.`
          }
        }
      ]
    };
  }
);

// 5. Get Version Date Prompt
server.prompt(
  'get_version_date_prompt',
  'Generates a request to find the publish date for a specific version of a specified npm package.',
  GetVersionDateArgsSchema.shape,
  async (args: GetVersionDateArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request for the publish date of version ${args.version} of '${args.packageName}'.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `What was the publish date of version ${args.version} for '${args.packageName}'?`
          }
        }
      ]
    };
  }
);

// 6. Get Downloads Prompt
server.prompt(
  'get_downloads_prompt',
  'Generates a request for the download count of a specified npm package over a specific time period.',
  GetDownloadsArgsSchema.shape,
  async (args: GetDownloadsArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request for the download count of '${args.packageName}' in the ${args.timePeriod}.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `How many times was '${args.packageName}' downloaded in the ${args.timePeriod}?`
          }
        }
      ]
    };
  }
);

// 7. Get All Downloads Prompt
server.prompt(
  'get_all_downloads_prompt',
  'Generates a request for the download counts of a specified npm package for the last day, week, and month.',
  PackageNameArgsSchema.shape,
  async (args: PackageNameArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request for all default download counts for '${args.packageName}'.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Get the download counts for '${args.packageName}' for the last day, week, and month.`
          }
        }
      ]
    };
  }
);

// 8. Audit Project Prompt
server.prompt(
  'audit_project_prompt',
  'Generates a request to audit the dependencies in a specified project directory for security vulnerabilities.',
  NpmAuditArgsSchema.shape,
  async (args: NpmAuditArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request to audit dependencies in '${args.projectPath}'.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Audit the dependencies in the project at '${args.projectPath}' for security vulnerabilities.`
          }
        }
      ]
    };
  }
);

// 9. Simulate Audit Fix Prompt
server.prompt(
  'simulate_audit_fix_prompt',
  'Generates a request to simulate running `npm audit fix` on a specified project directory.',
  SimulateNpmAuditFixArgsSchema.shape,
  async (args: SimulateNpmAuditFixArgs): Promise<GetPromptResult> => {
    return {
      description: `Generates a request to simulate 'npm audit fix' in '${args.projectPath}'.`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Simulate running 'npm audit fix' on the project at '${args.projectPath}' and show me what would change.`
          }
        }
      ]
    };
  }
);

async function main() {
  console.error(`[${new Date().toISOString()}] Starting NPMJS MCP Server...`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${new Date().toISOString()}] NPMJS MCP Server connected and listening via StdioTransport.`
  );
}

main().catch(error => {
  console.error(`[${new Date().toISOString()}] Fatal error in main():`, error);
  process.exit(1);
});
