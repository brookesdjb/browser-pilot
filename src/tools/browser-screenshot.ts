import { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';
import { BrowserInterface } from '../types/browser-interface.js';
import { promises as fs } from 'fs';
import { join } from 'path';

const TakeScreenshotSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to screenshot (current active tab if not specified)'),
  fullPage: z.boolean().default(false).optional().describe('Capture full page height (default: false)'),
  quality: z.number().min(0).max(100).default(90).optional().describe('JPEG quality 0-100 (default: 90)'),
  format: z.enum(['png', 'jpeg']).default('png').optional().describe('Image format (default: png)'),
  selector: z.string().optional().describe('CSS selector to screenshot specific element'),
  saveToFile: z.boolean().default(true).optional().describe('Save screenshot to file (default: true)'),
  filename: z.string().optional().describe('Custom filename (auto-generated if not provided)')
});

export class BrowserScreenshotTool {
  private bridge: BrowserInterface;

  constructor(bridge: BrowserInterface) {
    this.bridge = bridge;
  }

  getSchema() {
    return {
      name: 'take_screenshot',
      description: 'Take a screenshot of the current page or specific element for visual testing',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to screenshot (uses current active tab if not specified)',
            optional: true
          },
          fullPage: {
            type: 'boolean',
            description: 'Capture full page height instead of just viewport (default: false)',
            default: false,
            optional: true
          },
          quality: {
            type: 'number',
            description: 'JPEG quality 0-100 (default: 90)',
            minimum: 0,
            maximum: 100,
            default: 90,
            optional: true
          },
          format: {
            type: 'string',
            description: 'Image format: png or jpeg (default: png)',
            enum: ['png', 'jpeg'],
            default: 'png',
            optional: true
          },
          selector: {
            type: 'string',
            description: 'CSS selector to screenshot specific element (screenshots full page if not specified)',
            optional: true
          },
          saveToFile: {
            type: 'boolean',
            description: 'Save screenshot to file in project directory (default: true)',
            default: true,
            optional: true
          },
          filename: {
            type: 'string',
            description: 'Custom filename without extension (auto-generated if not provided)',
            optional: true
          }
        }
      }
    };
  }

  private generateFilename(url: string, format: string, selector?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    let urlPart = '';
    
    try {
      const urlObj = new URL(url);
      urlPart = urlObj.hostname.replace(/[^a-z0-9]/gi, '-');
      if (urlObj.pathname !== '/') {
        urlPart += urlObj.pathname.replace(/[^a-z0-9]/gi, '-').replace(/--+/g, '-');
      }
    } catch {
      urlPart = 'screenshot';
    }

    const elementPart = selector ? `-${selector.replace(/[^a-z0-9]/gi, '-').replace(/--+/g, '-')}` : '';
    return `screenshot-${urlPart}${elementPart}-${timestamp}.${format}`;
  }

  async execute(args: unknown): Promise<CallToolResult> {
    try {
      const params = TakeScreenshotSchema.parse(args || {});

      const isConnected = await this.bridge.isConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      // Get current tab info for filename generation
      const tabInfo = await this.bridge.sendCommand('get_current_url', {});
      if (!tabInfo.success) {
        return {
          content: [{ type: 'text', text: `Failed to get tab information: ${tabInfo.error || 'Unknown error'}` }],
          isError: true,
        };
      }

      // Take screenshot via extension
      const screenshotParams = {
        tabId: params.tabId,
        fullPage: params.fullPage,
        quality: params.quality,
        format: params.format,
        selector: params.selector
      };

      const result = await this.bridge.sendCommand('take_screenshot', screenshotParams);

      if (result.success) {
        const data = result.data;
        let responseText = `**Screenshot Captured** 📷\n\n`;
        
        responseText += `**URL:** ${data.url || tabInfo.data.url}\n`;
        responseText += `**Title:** ${data.title || tabInfo.data.title}\n`;
        responseText += `**Tab ID:** ${data.tabId}\n`;
        responseText += `**Format:** ${(params.format ?? 'png').toUpperCase()}\n`;
        responseText += `**Full Page:** ${params.fullPage ? 'Yes' : 'Viewport only'}\n`;
        
        if (params.selector) {
          responseText += `**Element Selector:** ${params.selector}\n`;
        }
        
        if (data.dimensions) {
          responseText += `**Dimensions:** ${data.dimensions.width}x${data.dimensions.height}px\n`;
        }

        // Save to file if requested
        if (params.saveToFile && data.dataUrl) {
          try {
            const format = params.format ?? 'png';
            const filename = params.filename ? 
              `${params.filename}.${format}` : 
              this.generateFilename(data.url || tabInfo.data.url, format, params.selector);
            
            const filepath = join(process.cwd(), 'screenshots', filename);
            
            // Ensure screenshots directory exists
            const screenshotsDir = join(process.cwd(), 'screenshots');
            await fs.mkdir(screenshotsDir, { recursive: true });

            // Convert data URL to buffer and save
            const base64Data = data.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(filepath, buffer);

            responseText += `**Saved to:** ${filepath}\n`;
            responseText += `**File Size:** ${Math.round(buffer.length / 1024)}KB\n`;
          } catch (error) {
            responseText += `**Save Error:** ${error instanceof Error ? error.message : String(error)}\n`;
          }
        }

        if (data.dataUrl && !params.saveToFile) {
          responseText += `**Data URL:** ${data.dataUrl.substring(0, 100)}...\n`;
        }

        responseText += `\n✅ Screenshot captured successfully!`;
        
        const content: (TextContent | ImageContent)[] = [{ type: 'text', text: responseText }];
        
        // Add image content for direct visual analysis if we have the data URL
        if (data.dataUrl) {
          try {
            // Extract base64 data from data URL (remove data:image/png;base64, prefix)
            const base64Data = data.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
            
            // Validate base64 by attempting to create buffer
            Buffer.from(base64Data, 'base64');
            
            content.push({
              type: 'image',
              data: base64Data,
              mimeType: `image/${params.format ?? 'png'}`
            });
          } catch (error) {
            responseText += `\n⚠️ Note: Image data validation failed`;
          }
        }
        
        return {
          content,
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to take screenshot: ${result.error || 'Unknown error'}` }],
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