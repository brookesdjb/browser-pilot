#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { program } from 'commander';
import { promises as fs } from 'fs';
import { ConsoleLogsTool } from './tools/console-logs.js';
import { BrowserNavigationTool } from './tools/browser-navigation.js';
import { BrowserStorageTool } from './tools/browser-storage.js';
import { versionTool, executeGetVersion } from './tools/version.js';
import { ExtensionBridge } from './utils/extension-bridge.js';

const SERVER_NAME = 'enhanced-browser-mcp';
const SERVER_VERSION = '0.8.0';

async function createServer(wsLogFilePath?: string): Promise<Server> {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Initialize shared extension bridge
  const extensionBridge = new ExtensionBridge(wsLogFilePath);
  
  // Initialize tools
  const consoleLogsTool = new ConsoleLogsTool(extensionBridge);
  const browserNavigationTool = new BrowserNavigationTool(extensionBridge);
  const browserStorageTool = new BrowserStorageTool(extensionBridge);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        consoleLogsTool.getSchema(),
        browserNavigationTool.getNavigateSchema(),
        browserNavigationTool.getCurrentUrlSchema(),
        browserStorageTool.getLocalStorageSchema(),
        browserStorageTool.getSessionStorageSchema(),
        browserStorageTool.getCookiesSchema(),
        versionTool
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_console_logs':
          return await consoleLogsTool.execute(args);
        
        case 'navigate_to_url':
          return await browserNavigationTool.executeNavigate(args);
          
        case 'get_current_url':
          return await browserNavigationTool.executeGetCurrentUrl(args);
          
        case 'get_local_storage':
          return await browserStorageTool.executeGetLocalStorage(args);
          
        case 'get_session_storage':
          return await browserStorageTool.executeGetSessionStorage(args);
          
        case 'get_cookies':
          return await browserStorageTool.executeGetCookies(args);
          
        case 'get_version':
          const versionInfo = await executeGetVersion();
          return {
            content: [
              {
                type: 'text',
                text: versionInfo,
              },
            ],
          };
        
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// CLI setup
program
  .name(SERVER_NAME)
  .description('Enhanced MCP server for browser automation with full DevTools access')
  .version(SERVER_VERSION)
  .action(async () => {
    // Write startup file
    let startupFile: string;
    try {
      startupFile = `mcp-server-startup-${SERVER_VERSION}-${Date.now()}.txt`;
      await fs.writeFile(startupFile, `Hello World! MCP Server v${SERVER_VERSION} started at ${new Date().toISOString()}\n\n=== WebSocket Messages ===\n`);
      console.error(`Startup file written: ${startupFile}`);
    } catch (error) {
      console.error('Failed to write startup file:', error);
      startupFile = '';
    }
    
    const server = await createServer(startupFile);
    const transport = new StdioServerTransport();
    
    console.error('Enhanced Browser MCP server starting...');
    await server.connect(transport);
    console.error('Enhanced Browser MCP server connected');
  });

program.parse();