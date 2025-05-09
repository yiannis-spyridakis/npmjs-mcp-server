#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';

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
    version: '0.1.0'
  },
  {
    capabilities: {
      resources: {}, // No resources defined for now
      tools: {} // Tools will be added via setRequestHandler
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

// Union schema for all tool arguments for parsing in CallTool handler
const AnyToolArgsSchema = z.union([
  PackageNameArgsSchema,
  PackageDownloadsArgsSchema
  // Add other tool arg schemas here if they differ significantly
  // For now, all our tools fit one of these two patterns
]);

// Define Input Schemas for tools (as plain objects for SDK)
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
    }
  ];
  return { tools };
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

    // Validate arguments using Zod
    const parseResult = AnyToolArgsSchema.safeParse(args);
    if (!parseResult.success) {
      throw new Error(
        `Invalid arguments for tool ${toolName}: ${
          parseResult.error.flatten().fieldErrors
        }`
      );
    }
    const validatedArgs = parseResult.data;

    // All our current tools require packageName
    if (!('packageName' in validatedArgs) || !validatedArgs.packageName) {
      throw new Error(
        "Argument 'packageName' is required and was not provided or is empty."
      );
    }
    const encodedPackageName = encodePackageName(validatedArgs.packageName);

    try {
      let resultData: any;
      switch (toolName) {
        case 'get_npm_package_summary': {
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForSummary(rawData, sourceUrl);
          break;
        }
        case 'get_npm_package_versions': {
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForVersions(rawData, sourceUrl);
          break;
        }
        case 'get_npm_package_downloads': {
          const period =
            'period' in validatedArgs ? validatedArgs.period : undefined;
          resultData = await fetchPackageDownloads(encodedPackageName, period);
          break;
        }
        case 'get_npm_package_details': {
          const rawData = await fetchPackageData(encodedPackageName);
          const sourceUrl = `${NPM_REGISTRY_BASE_URL}/${encodedPackageName}`;
          resultData = transformDataForDetails(rawData, sourceUrl);
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
        console.error(
          `[${new Date().toISOString()}] NpmApiError in tool ${toolName} for ${
            validatedArgs.packageName
          }: ${error.message} (Code: ${error.code}, Status: ${
            error.statusCode
          })`
        );
        throw new Error(error.message);
      }
      console.error(
        `[${new Date().toISOString()}] Unknown error in tool ${toolName} for ${
          validatedArgs.packageName
        }: ${(error as Error).message}`
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
