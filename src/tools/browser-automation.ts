import { CallToolResult, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';

const ClickElementSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to perform action on (current active tab if not specified)'),
  selector: z.string().optional().describe('CSS selector to identify element to click'),
  text: z.string().optional().describe('Text content to search for in clickable elements'),
  includeScreenshot: z.boolean().default(true).optional().describe('Include before/after screenshots for verification'),
  waitAfterClick: z.number().default(500).optional().describe('Milliseconds to wait after clicking (default: 500ms)')
});

export class BrowserAutomationTool {
  private bridge: ExtensionBridge;

  constructor(bridge: ExtensionBridge) {
    this.bridge = bridge;
  }

  getClickElementSchema() {
    return {
      name: 'click_element',
      description: 'Click on web elements using JavaScript execution via Chrome extension',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to perform action on (uses current active tab if not specified)',
            optional: true
          },
          selector: {
            type: 'string',
            description: 'CSS selector to identify element to click (e.g., "button", ".drugs-link", "#submit")',
            optional: true
          },
          text: {
            type: 'string',
            description: 'Text content to search for in clickable elements (e.g., "Drugs", "Submit", "Login")',
            optional: true
          },
          includeScreenshot: {
            type: 'boolean',
            description: 'Include before/after screenshots for verification (default: true)',
            default: true,
            optional: true
          },
          waitAfterClick: {
            type: 'number',
            description: 'Milliseconds to wait after clicking (default: 500ms)',
            default: 500,
            optional: true
          }
        }
      }
    };
  }


  async executeClickElement(args: unknown): Promise<CallToolResult> {
    try {
      const params = ClickElementSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      let responseText = `**Browser Automation - Click Element** 🎯\n\n`;
      const content: (TextContent | ImageContent)[] = [];

      // Get current tab info
      const tabInfo = await this.bridge.sendCommand('get_current_url', {});
      if (!tabInfo.success) {
        return {
          content: [{ type: 'text', text: `Failed to get tab information: ${tabInfo.error || 'Unknown error'}` }],
          isError: true,
        };
      }

      const targetTabId = params.tabId || tabInfo.data.tabId;
      responseText += `🔗 **Target Tab:** ${tabInfo.data.title} (ID: ${targetTabId})\n`;
      responseText += `📍 **URL:** ${tabInfo.data.url}\n\n`;

      // Take initial screenshot if requested
      let beforeScreenshot = null;
      if (params.includeScreenshot) {
        const screenshotResult = await this.bridge.sendCommand('take_screenshot', {
          tabId: targetTabId,
          fullPage: false
        });
        
        if (screenshotResult.success && screenshotResult.data.dataUrl) {
          beforeScreenshot = screenshotResult.data.dataUrl;
          responseText += `📸 **Before Screenshot Captured**\n`;
        }
      }

      // Find and click element
      if (!params.selector && !params.text) {
        return {
          content: [{ 
            type: 'text', 
            text: responseText + `❌ **Error:** Must specify either selector or text to identify click target` 
          }],
          isError: true,
        };
      }

      const clickResult = await this.bridge.sendCommand('click_element_by_identifier', {
        tabId: targetTabId,
        selector: params.selector,
        text: params.text
      });

      if (clickResult.success) {
        responseText += `✅ **Element Click Successful!**\n\n`;
        responseText += `- ${clickResult.message || 'Element clicked successfully'}\n`;
        responseText += `- Element: ${clickResult.elementTag || 'unknown'}\n`;
        responseText += `- Text: "${clickResult.elementText || 'unknown'}"\n`;
        if (clickResult.selector) {
          responseText += `- Selector: ${clickResult.selector}\n`;
        }
        
        // Wait after click
        const waitTime = params.waitAfterClick ?? 500;
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          responseText += `- Waited: ${waitTime}ms\n`;
        }

        // Take after screenshot if requested
        if (params.includeScreenshot) {
          const afterScreenshotResult = await this.bridge.sendCommand('take_screenshot', {
            tabId: targetTabId,
            fullPage: false
          });
          
          if (afterScreenshotResult.success && afterScreenshotResult.data.dataUrl) {
            responseText += `📸 **After Screenshot Captured**\n\n`;
            
            // Add before and after screenshots to content
            if (beforeScreenshot) {
              content.push({ type: 'text', text: responseText });
              content.push({ type: 'text', text: '**Before Click:**' });
              content.push({
                type: 'image',
                data: beforeScreenshot.replace(/^data:image\/[a-z]+;base64,/, ''),
                mimeType: 'image/png'
              });
              content.push({ type: 'text', text: '**After Click:**' });
              content.push({
                type: 'image',
                data: afterScreenshotResult.data.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
                mimeType: 'image/png'
              });
              
              return { content };
            }
          }
        }
        
        responseText += `🎉 **Element Click Complete**`;
      } else {
        responseText += `❌ **Element Click Failed:** ${clickResult.error || clickResult.message}`;
        return {
          content: [{ type: 'text', text: responseText }],
          isError: true,
        };
      }

      content.push({ type: 'text', text: responseText });
      return { content };

    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

}