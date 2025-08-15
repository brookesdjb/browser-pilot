import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';

const GetNetworkRequestsSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to get network requests from (current active tab if not specified)'),
  limit: z.number().min(1).max(1000).default(50).optional().describe('Maximum number of requests to return (default: 50)'),
  method: z.string().optional().describe('Filter by HTTP method (GET, POST, etc.)'),
  status: z.number().optional().describe('Filter by HTTP status code'),
  since: z.number().optional().describe('Only return requests after this timestamp (Unix timestamp in milliseconds)')
});

export class BrowserNetworkTool {
  private bridge: ExtensionBridge;

  constructor(bridge: ExtensionBridge) {
    this.bridge = bridge;
  }

  getSchema() {
    return {
      name: 'get_network_requests',
      description: 'Get network requests (XHR/fetch) captured since page load',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get network requests from (uses current active tab if not specified)',
            optional: true
          },
          limit: {
            type: 'number',
            description: 'Maximum number of requests to return (default: 50, max: 1000)',
            minimum: 1,
            maximum: 1000,
            default: 50,
            optional: true
          },
          method: {
            type: 'string',
            description: 'Filter by HTTP method (GET, POST, PUT, DELETE, etc.)',
            optional: true
          },
          status: {
            type: 'number',
            description: 'Filter by HTTP status code (200, 404, 500, etc.)',
            optional: true
          },
          since: {
            type: 'number',
            description: 'Only return requests after this timestamp (Unix timestamp in milliseconds)',
            optional: true
          }
        }
      }
    };
  }

  async execute(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetNetworkRequestsSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      const result = await this.bridge.sendCommand('get_network_requests', params);

      if (result.success) {
        const data = result.data;
        let responseText = `**Network Requests** (Tab ${data.tabId})\n\n`;
        responseText += `**Total Requests:** ${data.totalCount}\n`;
        responseText += `**Returned:** ${data.requests.length}\n`;
        
        if (data.since) {
          responseText += `**Since:** ${new Date(data.since).toISOString()}\n`;
        }
        
        responseText += `\n**Requests:**\n`;
        
        if (data.requests.length === 0) {
          responseText += `*No network requests found*`;
        } else {
          data.requests.forEach((req: any, index: number) => {
            const duration = req.timing?.duration ? `${Math.round(req.timing.duration)}ms` : 'N/A';
            const size = req.responseSize ? `${Math.round(req.responseSize / 1024)}KB` : 'N/A';
            
            responseText += `\n**${index + 1}. ${req.method} ${req.status || 'pending'}**\n`;
            responseText += `• **URL:** ${req.url}\n`;
            responseText += `• **Status:** ${req.status || 'pending'} ${req.statusText || ''}\n`;
            responseText += `• **Duration:** ${duration}\n`;
            responseText += `• **Size:** ${size}\n`;
            responseText += `• **Time:** ${new Date(req.timestamp).toLocaleTimeString()}\n`;
            
            if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
              responseText += `• **Request Headers:** ${Object.keys(req.requestHeaders).length} headers\n`;
            }
            
            if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
              responseText += `• **Response Headers:** ${Object.keys(req.responseHeaders).length} headers\n`;
            }
          });
        }
        
        return {
          content: [{ type: 'text', text: responseText }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to get network requests: ${result.error || 'Unknown error'}` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
}