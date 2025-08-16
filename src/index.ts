#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { program } from 'commander';
import { promises as fs } from 'fs';
import { ConsoleLogsTool } from './tools/console-logs.js';
import { BrowserNavigationTool } from './tools/browser-navigation.js';
import { BrowserStorageTool } from './tools/browser-storage.js';
import { BrowserNetworkTool } from './tools/browser-network.js';
import { BrowserDomTool } from './tools/browser-dom.js';
import { BrowserScreenshotTool } from './tools/browser-screenshot.js';
import { BrowserAutomationTool } from './tools/browser-automation.js';
import { versionTool, executeGetVersion } from './tools/version.js';
import browserPilotClient from './mcp-client/browser-pilot-client.js';
import { join } from 'path';
import { homedir } from 'os';

const SERVER_NAME = 'browser-pilot';
const SERVER_VERSION = '1.0.0';

// Check for Chrome Native Messaging Host installation
async function checkNativeHostInstallation(): Promise<boolean> {
  try {
    // Check for manifest file in platform-specific location
    let manifestPath = '';
    if (process.platform === 'darwin') {
      // macOS
      manifestPath = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.brookesdjb.browser_pilot.json');
    } else if (process.platform === 'linux') {
      // Linux
      manifestPath = join(homedir(), '.config/google-chrome/NativeMessagingHosts/com.brookesdjb.browser_pilot.json');
    } else if (process.platform === 'win32') {
      // Windows - Check via registry would be better, but we'll check typical location
      manifestPath = join(homedir(), 'AppData/Local/BrowserPilot/com.brookesdjb.browser_pilot.json');
    }

    // Check if manifest file exists
    await fs.access(manifestPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function createServer(logFilePath?: string): Promise<Server> {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: 'Browser Pilot - Intelligent browser automation with Chrome DevTools integration. Best Practice: Use get_dom_snapshot before click_element or type_text to inspect page structure and find correct selectors.',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Initialize tools (now using browserPilotClient instead of extensionBridge)
  const consoleLogsTool = new ConsoleLogsTool(browserPilotClient);
  const browserNavigationTool = new BrowserNavigationTool(browserPilotClient);
  const browserStorageTool = new BrowserStorageTool(browserPilotClient);
  const browserNetworkTool = new BrowserNetworkTool(browserPilotClient);
  const browserDomTool = new BrowserDomTool(browserPilotClient);
  const browserScreenshotTool = new BrowserScreenshotTool(browserPilotClient);
  const browserAutomationTool = new BrowserAutomationTool(browserPilotClient);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Primary inspection tools first
        browserDomTool.getSchema(),
        browserScreenshotTool.getSchema(),
        
        // Navigation and automation tools
        browserNavigationTool.getNavigateSchema(),
        browserNavigationTool.getCurrentUrlSchema(),
        browserAutomationTool.getClickElementSchema(),
        browserAutomationTool.getTypeTextSchema(),
        
        // Data extraction tools
        browserStorageTool.getLocalStorageSchema(),
        browserStorageTool.getSessionStorageSchema(),
        browserStorageTool.getCookiesSchema(),
        browserNetworkTool.getSchema(),
        consoleLogsTool.getSchema(),
        
        // Utility tools
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
          
        case 'get_network_requests':
          return await browserNetworkTool.execute(args);
          
        case 'get_dom_snapshot':
          return await browserDomTool.execute(args);
          
        case 'take_screenshot':
          return await browserScreenshotTool.execute(args);
          
        case 'click_element':
          return await browserAutomationTool.executeClickElement(args);
          
        case 'type_text':
          return await browserAutomationTool.executeTypeText(args);
          
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
  .description('Browser Pilot - Intelligent browser automation with Chrome DevTools integration')
  .version(SERVER_VERSION)
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    console.error(`Browser Pilot v${SERVER_VERSION} starting...`);
    
    // Check for native host installation
    const hostInstalled = await checkNativeHostInstallation();
    if (!hostInstalled) {
      console.error('Native messaging host not installed. Please run the installer script first.');
      console.error('See installation instructions: https://github.com/brookesdjb/browser-pilot#installation');
      process.exit(1);
    }

    // Configure client with debug flag if provided
    browserPilotClient.debug = options.debug || false;
    
    // Connect to native host broker
    try {
      console.error('Connecting to Browser Pilot native host...');
      await browserPilotClient.connect();
      console.error('Connected to Browser Pilot native host!');
    } catch (error) {
      console.error('Failed to connect to Browser Pilot native host:', error instanceof Error ? error.message : String(error));
      console.error('Please ensure the native host is installed and the browser extension is running.');
      process.exit(1);
    }
    
    // Create and connect MCP server
    const server = await createServer();
    const transport = new StdioServerTransport();
    
    console.error('Browser Pilot MCP server starting...');
    await server.connect(transport);
    console.error('Browser Pilot MCP server connected');
  });

program.parse();