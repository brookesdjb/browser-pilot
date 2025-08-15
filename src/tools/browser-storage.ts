import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';

const GetStorageSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to get storage from (current active tab if not specified)')
});

export class BrowserStorageTool {
  private bridge: ExtensionBridge;

  constructor(bridge: ExtensionBridge) {
    this.bridge = bridge;
  }

  getLocalStorageSchema() {
    return {
      name: 'get_local_storage',
      description: 'Get local storage items from a browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get local storage from (uses current active tab if not specified)',
            optional: true
          }
        }
      }
    };
  }

  getSessionStorageSchema() {
    return {
      name: 'get_session_storage',
      description: 'Get session storage items from a browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get session storage from (uses current active tab if not specified)',
            optional: true
          }
        }
      }
    };
  }

  getCookiesSchema() {
    return {
      name: 'get_cookies',
      description: 'Get cookies from a browser tab',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get cookies from (uses current active tab if not specified)',
            optional: true
          }
        }
      }
    };
  }

  async executeGetLocalStorage(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetStorageSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      const result = await this.bridge.sendCommand('get_local_storage', params);

      if (result.success) {
        const data = result.data;
        return {
          content: [{ type: 'text', text: `**Local Storage** (Tab ${data.tabId})\n\n${JSON.stringify(data.items, null, 2)}` }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to get local storage: ${result.error || 'Unknown error'}` }],
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

  async executeGetSessionStorage(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetStorageSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      const result = await this.bridge.sendCommand('get_session_storage', params);

      if (result.success) {
        const data = result.data;
        return {
          content: [{ type: 'text', text: `**Session Storage** (Tab ${data.tabId})\n\n${JSON.stringify(data.items, null, 2)}` }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to get session storage: ${result.error || 'Unknown error'}` }],
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

  async executeGetCookies(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetStorageSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      const result = await this.bridge.sendCommand('get_cookies', params);

      if (result.success) {
        const data = result.data;
        return {
          content: [{ type: 'text', text: `**Cookies** (Tab ${data.tabId})\n\n${JSON.stringify(data.cookies, null, 2)}` }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to get cookies: ${result.error || 'Unknown error'}` }],
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