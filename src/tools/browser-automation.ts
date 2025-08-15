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

const TypeTextSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to perform action on (current active tab if not specified)'),
  selector: z.string().optional().describe('CSS selector to identify input element'),
  text: z.string().optional().describe('Text content to search for in input elements (placeholder, label, etc.)'),
  textToType: z.string().describe('Text to type into the element'),
  clearFirst: z.boolean().default(true).optional().describe('Clear existing text before typing (default: true)'),
  submit: z.boolean().default(false).optional().describe('Press Enter after typing (default: false)'),
  includeScreenshot: z.boolean().default(true).optional().describe('Include before/after screenshots for verification'),
  waitAfterType: z.number().default(500).optional().describe('Milliseconds to wait after typing (default: 500ms)')
});

export class BrowserAutomationTool {
  private bridge: ExtensionBridge;

  constructor(bridge: ExtensionBridge) {
    this.bridge = bridge;
  }

  getClickElementSchema() {
    return {
      name: 'click_element',
      description: 'Click on web elements using JavaScript execution via Chrome extension. IMPORTANT: Use get_dom_snapshot first to inspect elements and find correct selectors, especially for dynamic content with generated IDs.',
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
            description: 'CSS selector to identify element to click (e.g., "button", ".drugs-link", "#submit"). Use get_dom_snapshot to find exact selectors for dynamic elements.',
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

  getTypeTextSchema() {
    return {
      name: 'type_text',
      description: 'Type text into input elements using JavaScript execution via Chrome extension. IMPORTANT: Use get_dom_snapshot first to inspect input elements and find correct selectors, as form field IDs are often dynamically generated.',
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
            description: 'CSS selector to identify input element (e.g., "input[type=\'email\']", "#username", ".search-box"). Use get_dom_snapshot to find exact selectors for dynamic form fields.',
            optional: true
          },
          text: {
            type: 'string',
            description: 'Text content to search for in input elements (placeholder, label, etc.)',
            optional: true
          },
          textToType: {
            type: 'string',
            description: 'Text to type into the element'
          },
          clearFirst: {
            type: 'boolean',
            description: 'Clear existing text before typing (default: true)',
            default: true,
            optional: true
          },
          submit: {
            type: 'boolean',
            description: 'Press Enter after typing (default: false)',
            default: false,
            optional: true
          },
          includeScreenshot: {
            type: 'boolean',
            description: 'Include before/after screenshots for verification (default: true)',
            default: true,
            optional: true
          },
          waitAfterType: {
            type: 'number',
            description: 'Milliseconds to wait after typing (default: 500ms)',
            default: 500,
            optional: true
          }
        },
        required: ['textToType']
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
            text: responseText + `❌ **Error:** Must specify either selector or text to identify click target\\n\\n💡 **Tip:** Use get_dom_snapshot to inspect page elements first.` 
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
        responseText += `❌ **Element Click Failed:** ${clickResult.error || clickResult.message}\\n\\n`;
        responseText += `💡 **Suggestion:** Use get_dom_snapshot to inspect the page structure and find the correct element selectors.`;
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

  async executeTypeText(args: unknown): Promise<CallToolResult> {
    try {
      const params = TypeTextSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      let responseText = `**Browser Automation - Type Text** ⌨️\\n\\n`;
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
      responseText += `🔗 **Target Tab:** ${tabInfo.data.title} (ID: ${targetTabId})\\n`;
      responseText += `📍 **URL:** ${tabInfo.data.url}\\n`;
      responseText += `📝 **Text to Type:** "${params.textToType}"\\n\\n`;

      // Take initial screenshot if requested
      let beforeScreenshot = null;
      if (params.includeScreenshot) {
        const screenshotResult = await this.bridge.sendCommand('take_screenshot', {
          tabId: targetTabId,
          fullPage: false
        });
        
        if (screenshotResult.success && screenshotResult.data.dataUrl) {
          beforeScreenshot = screenshotResult.data.dataUrl;
          responseText += `📸 **Before Screenshot Captured**\\n`;
        }
      }

      // Find and type in element
      if (!params.selector && !params.text) {
        return {
          content: [{ 
            type: 'text', 
            text: responseText + `❌ **Error:** Must specify either selector or text to identify input target` 
          }],
          isError: true,
        };
      }

      const typeResult = await this.bridge.sendCommand('type_text_in_element', {
        tabId: targetTabId,
        selector: params.selector,
        text: params.text,
        textToType: params.textToType,
        clearFirst: params.clearFirst,
        submit: params.submit
      });

      if (typeResult.success) {
        responseText += `✅ **Text Input Successful!**\\n\\n`;
        responseText += `- ${typeResult.message || 'Text entered successfully'}\\n`;
        responseText += `- Element Type: ${typeResult.elementType || 'unknown'}\\n`;
        responseText += `- Placeholder: "${typeResult.elementPlaceholder || 'none'}"\\n`;
        if (typeResult.selector) {
          responseText += `- Selector: ${typeResult.selector}\\n`;
        }
        if (typeResult.submitted) {
          responseText += `- Submitted: Yes (Enter pressed)\\n`;
        }
        
        // Wait after typing
        const waitTime = params.waitAfterType ?? 500;
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          responseText += `- Waited: ${waitTime}ms\\n`;
        }

        // Take after screenshot if requested
        if (params.includeScreenshot) {
          const afterScreenshotResult = await this.bridge.sendCommand('take_screenshot', {
            tabId: targetTabId,
            fullPage: false
          });
          
          if (afterScreenshotResult.success && afterScreenshotResult.data.dataUrl) {
            responseText += `📸 **After Screenshot Captured**\\n\\n`;
            
            // Add before and after screenshots to content
            if (beforeScreenshot) {
              content.push({ type: 'text', text: responseText });
              content.push({ type: 'text', text: '**Before Typing:**' });
              content.push({
                type: 'image',
                data: beforeScreenshot.replace(/^data:image\/[a-z]+;base64,/, ''),
                mimeType: 'image/png'
              });
              content.push({ type: 'text', text: '**After Typing:**' });
              content.push({
                type: 'image',
                data: afterScreenshotResult.data.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
                mimeType: 'image/png'
              });
              
              return { content };
            }
          }
        }
        
        responseText += `🎉 **Text Input Complete**`;
      } else {
        responseText += `❌ **Text Input Failed:** ${typeResult.error || typeResult.message}\\n\\n`;
        responseText += `💡 **Suggestion:** Use get_dom_snapshot to inspect form elements and find the correct input field selectors.`;
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