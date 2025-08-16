import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';
import { BrowserInterface } from '../types/browser-interface.js';
import type { GetConsoleLogsParams } from '../types/console.js';

const GetConsoleLogsSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to get logs from (current tab if not specified)'),
  limit: z.number().min(1).max(1000).default(50).describe('Maximum number of logs to return (default: 50)'),
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional().describe('Filter logs by level'),
  since: z.number().optional().describe('Only return logs after this timestamp')
});

export class ConsoleLogsTool {
  private bridge: BrowserInterface;

  constructor(bridge?: BrowserInterface) {
    this.bridge = bridge || new ExtensionBridge();
  }

  getSchema() {
    return {
      name: 'get_console_logs',
      description: 'Get console logs from the browser with advanced filtering. Captures all console.log, console.error, console.warn, console.info calls and JavaScript exceptions. Results are organized by browser tab.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get logs from. If not specified, returns logs from all tabs. Use this to focus on a specific browser tab.',
            optional: true
          },
          limit: {
            type: 'number',
            description: 'Maximum number of logs to return per tab (default: 50)',
            minimum: 1,
            maximum: 1000,
            default: 50
          },
          level: {
            type: 'string',
            enum: ['log', 'info', 'warn', 'error', 'debug'],
            description: 'Filter logs by level across all tabs',
            optional: true
          },
          since: {
            type: 'number',
            description: 'Only return logs after this timestamp (Unix timestamp in milliseconds)',
            optional: true
          }
        }
      }
    };
  }

  async execute(args: unknown): Promise<CallToolResult> {
    try {
      // Validate input parameters
      const params = GetConsoleLogsSchema.parse(args || {});

      // Check if extension is connected
      const isConnected = await this.bridge.isConnected();
      const connectionStatus = isConnected ? 'Connected to extension' : 'Using mock data (extension not connected)';

      // Get console logs from extension (now returns TabLogData[])
      const tabLogData = await this.bridge.getConsoleLogs(params);

      if (tabLogData.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `${connectionStatus}\n\nNo console logs found matching the criteria.`,
            },
          ],
        };
      }

      // Format logs grouped by tab
      let output = `${connectionStatus}\n\n`;
      let totalLogs = 0;

      tabLogData.forEach(tabData => {
        totalLogs += tabData.logs.length;
        
        // Tab header
        output += `## Tab ${tabData.tabId}: ${tabData.tabTitle}\n`;
        output += `URL: ${tabData.tabUrl}\n`;
        output += `Showing ${tabData.logs.length} of ${tabData.totalCount} logs\n\n`;

        // Format logs for this tab
        const formattedLogs = tabData.logs.map(log => {
          const timestamp = new Date(log.timestamp).toISOString();
          const level = log.level.toUpperCase().padEnd(5);
          return `  [${timestamp}] ${level} ${log.message}${log.lineNumber ? ` (line ${log.lineNumber})` : ''}`;
        }).join('\n');

        output += formattedLogs + '\n\n';
      });

      // Summary
      const tabCount = tabLogData.length;
      output += `📊 **Summary**: ${totalLogs} logs from ${tabCount} tab${tabCount !== 1 ? 's' : ''}`;

      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
      };

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
            text: `Failed to get console logs: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}