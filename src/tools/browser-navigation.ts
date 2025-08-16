import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';
import { BrowserInterface } from '../types/browser-interface.js';

const NavigateToUrlSchema = z.object({
  url: z.string().url().describe('The URL to navigate to'),
  tabId: z.number().optional().describe('Tab ID to navigate (current active tab if not specified)'),
  timeout: z.number().min(1000).max(60000).default(15000).optional().describe('Navigation timeout in milliseconds (default: 15000)')
});

const GetCurrentUrlSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to get URL from (current active tab if not specified)')
});

export class BrowserNavigationTool {
  private bridge: BrowserInterface;

  constructor(bridge: BrowserInterface) {
    this.bridge = bridge;
  }

  getNavigateSchema() {
    return {
      name: 'navigate_to_url',
      description: 'Navigate a browser tab to a specified URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'The URL to navigate to (must be a valid HTTP/HTTPS URL)'
          },
          tabId: {
            type: 'number',
            description: 'Tab ID to navigate (uses current active tab if not specified)',
            optional: true
          },
          timeout: {
            type: 'number',
            description: 'Navigation timeout in milliseconds (default: 15000, max: 60000)',
            minimum: 1000,
            maximum: 60000,
            default: 15000,
            optional: true
          }
        },
        required: ['url']
      }
    };
  }

  getCurrentUrlSchema() {
    return {
      name: 'get_current_url',
      description: 'Get the current URL of a browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get URL from (uses current active tab if not specified)',
            optional: true
          }
        }
      }
    };
  }

  async executeNavigate(args: unknown): Promise<CallToolResult> {
    try {
      const params = NavigateToUrlSchema.parse(args || {});

      // Check if extension is connected
      const isConnected = await this.bridge.isConnected();
      if (!isConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.',
            },
          ],
          isError: true,
        };
      }

      // Send navigation command to extension with 5-second timeout (longer than 2-second navigation timeout)
      const result = await this.bridge.sendCommand('navigate_to_url', params, 5000);

      if (result.success) {
        const navData = result.data;
        let responseText = `✅ **Navigation Complete**\n\n`;
        
        // Basic navigation info
        responseText += `**Requested URL:** ${navData.requestedUrl}\n`;
        responseText += `**Final URL:** ${navData.finalUrl}\n`;
        responseText += `**Page Title:** ${navData.finalTitle}\n`;
        responseText += `**Tab ID:** ${navData.tabId}\n`;
        responseText += `**Navigation Time:** ${navData.navigationTimeMs}ms\n\n`;
        
        // Redirect information
        if (navData.redirectCount > 0) {
          responseText += `🔄 **Redirects:** ${navData.redirectCount} redirect${navData.redirectCount > 1 ? 's' : ''} occurred\n\n`;
          responseText += `**Navigation Flow:**\n`;
          
          navData.redirectChain.forEach((url: string, index: number) => {
            const isLast = index === navData.redirectChain.length - 1;
            const arrow = isLast ? '' : ' →';
            const step = index + 1;
            responseText += `${step}. ${url}${arrow}\n`;
          });
        } else {
          responseText += `✨ **Direct Navigation:** No redirects occurred`;
        }
        
        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to navigate to URL: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Failed to navigate: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async executeGetCurrentUrl(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetCurrentUrlSchema.parse(args || {});

      // Check if extension is connected
      const isConnected = await this.bridge.isConnected();
      if (!isConnected) {
        return {
          content: [
            {
              type: 'text',
              text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.',
            },
          ],
          isError: true,
        };
      }

      // Send get current URL command to extension
      const result = await this.bridge.sendCommand('get_current_url', params);

      if (result.success) {
        const tabInfo = result.data;
        
        return {
          content: [
            {
              type: 'text',
              text: `**Current Tab Info:**\n\n` +
                   `**URL:** ${tabInfo.url}\n` +
                   `**Title:** ${tabInfo.title}\n` +
                   `**Tab ID:** ${tabInfo.tabId}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get current URL: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Failed to get current URL: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}