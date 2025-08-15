import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ExtensionBridge } from '../utils/extension-bridge.js';

const GetDomSnapshotSchema = z.object({
  tabId: z.number().optional().describe('Tab ID to get DOM from (current active tab if not specified)'),
  includeStyles: z.boolean().default(false).optional().describe('Include computed styles (default: false)'),
  selector: z.string().optional().describe('CSS selector to capture specific element (captures full document if not specified)'),
  maxLength: z.number().default(10000).optional().describe('Maximum HTML content length to return (default: 10000 chars)'),
  smartExtraction: z.boolean().default(true).optional().describe('Enable intelligent framework detection and extraction (default: true)')
});

interface FrameworkInfo {
  name: string;
  version?: string;
  confidence: number;
  indicators: string[];
}

interface ExtractionStrategy {
  name: string;
  selectors: string[];
  description: string;
}

export class BrowserDomTool {
  private bridge: ExtensionBridge;

  constructor(bridge: ExtensionBridge) {
    this.bridge = bridge;
  }

  private detectFramework(html: string): FrameworkInfo | null {
    const frameworks = [
      {
        name: 'Angular',
        indicators: [
          '_ngcontent-',
          'ng-version',
          'angular',
          '_nghost-',
          'ng-reflect-',
          '@angular/',
          'ngDevMode'
        ],
        versionRegex: /"ng-version":"([^"]+)"/
      },
      {
        name: 'React',
        indicators: [
          'data-reactroot',
          'data-react-',
          '__REACT_DEVTOOLS_GLOBAL_HOOK__',
          'react-dom',
          '_react',
          'ReactDOM'
        ],
        versionRegex: /React.*?(\d+\.\d+\.\d+)/
      },
      {
        name: 'Vue',
        indicators: [
          'data-v-',
          'v-if',
          'v-for',
          'v-model',
          'vue-',
          '__VUE__',
          'data-vue-'
        ],
        versionRegex: /Vue.*?(\d+\.\d+\.\d+)/
      },
      {
        name: 'Svelte',
        indicators: [
          'svelte-',
          'data-svelte-',
          's-'
        ],
        versionRegex: /svelte.*?(\d+\.\d+\.\d+)/
      },
      {
        name: 'Next.js',
        indicators: [
          '__NEXT_DATA__',
          'next/dist',
          '_next/',
          'next-route-announcer'
        ],
        versionRegex: /"next":"([^"]+)"/
      }
    ];

    let bestMatch: FrameworkInfo | null = null;
    let highestScore = 0;

    for (const framework of frameworks) {
      let score = 0;
      const foundIndicators: string[] = [];

      for (const indicator of framework.indicators) {
        const count = (html.match(new RegExp(indicator, 'gi')) || []).length;
        if (count > 0) {
          score += Math.min(count, 10); // Cap individual indicator score
          foundIndicators.push(`${indicator} (${count}x)`);
        }
      }

      if (score > highestScore) {
        highestScore = score;
        const versionMatch = framework.versionRegex ? html.match(framework.versionRegex) : null;
        bestMatch = {
          name: framework.name,
          version: versionMatch ? versionMatch[1] : undefined,
          confidence: Math.min(score / 10, 1), // Normalize to 0-1
          indicators: foundIndicators
        };
      }
    }

    return bestMatch && highestScore >= 3 ? bestMatch : null;
  }

  private getFrameworkExtractionStrategy(framework: FrameworkInfo): ExtractionStrategy[] {
    const strategies: Record<string, ExtractionStrategy[]> = {
      'Angular': [
        {
          name: 'App Root',
          selectors: ['app-root'],
          description: 'Main Angular application component'
        },
        {
          name: 'Body Structure',
          selectors: ['body'],
          description: 'Document body with Angular components'
        },
        {
          name: 'Router Outlet',
          selectors: ['router-outlet'],
          description: 'Angular routing components'
        }
      ],
      'React': [
        {
          name: 'React Root',
          selectors: ['[data-reactroot]', '#root', '#app', '.App'],
          description: 'React application root container'
        },
        {
          name: 'Components',
          selectors: ['[data-react-]', '[class*="react-"]'],
          description: 'React components and elements'
        }
      ],
      'Vue': [
        {
          name: 'Vue App',
          selectors: ['[data-v-]', '#app', '.vue-app'],
          description: 'Vue application container'
        },
        {
          name: 'Vue Components',
          selectors: ['[v-if]', '[v-for]', '[v-model]'],
          description: 'Vue directive elements'
        }
      ],
      'Next.js': [
        {
          name: 'Next App',
          selectors: ['#__next', '[data-nextjs-scroll-focus-boundary]'],
          description: 'Next.js application container'
        }
      ],
      'Svelte': [
        {
          name: 'Svelte App',
          selectors: ['[data-svelte-]', '[class*="svelte-"]'],
          description: 'Svelte components'
        }
      ]
    };

    return strategies[framework.name] || [];
  }

  private extractFrameworkCore(html: string, framework: FrameworkInfo): string {
    const strategies = this.getFrameworkExtractionStrategy(framework);
    const extractedSections: string[] = [];

    // Add framework detection info
    extractedSections.push(`<!-- FRAMEWORK DETECTED: ${framework.name}${framework.version ? ' v' + framework.version : ''} (confidence: ${Math.round(framework.confidence * 100)}%) -->`);
    extractedSections.push(`<!-- Indicators: ${framework.indicators.join(', ')} -->\n`);

    // Extract head section but remove large style blocks
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch) {
      let cleanHead = headMatch[0];
      // Remove inline <style> blocks but keep other head elements
      cleanHead = cleanHead.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<!-- <style> block removed -->');
      extractedSections.push('<!-- HEAD SECTION (styles removed) -->');
      extractedSections.push(cleanHead);
      extractedSections.push('');
    }

    // Extract framework-specific sections using regex patterns
    for (const strategy of strategies) {
      extractedSections.push(`<!-- ${strategy.name.toUpperCase()}: ${strategy.description} -->`);
      
      for (const selector of strategy.selectors) {
        const elements = this.findElementsBySelector(html, selector);
        if (elements.length > 0) {
          extractedSections.push(`<!-- Found ${elements.length} element(s) matching "${selector}" -->`);
          
          // Limit to first 3 elements per selector
          elements.slice(0, 3).forEach((element, index) => {
            // Clean up the element by removing inline styles and script tags
            let cleanElement = element;
            cleanElement = cleanElement.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<!-- <style> removed -->');
            cleanElement = cleanElement.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- <script> removed -->');
            
            // Truncate large elements
            if (cleanElement.length > 3000) {
              const truncated = cleanElement.substring(0, 3000);
              const remaining = element.length - 3000;
              extractedSections.push(truncated + `\n  <!-- TRUNCATED: ${remaining} more chars -->`);
            } else {
              extractedSections.push(cleanElement);
            }
            
            if (index < Math.min(elements.length, 3) - 1) extractedSections.push('');
          });
          
          if (elements.length > 3) {
            extractedSections.push(`<!-- ... and ${elements.length - 3} more ${selector} elements -->`);
          }
          break; // Found elements for this strategy, move to next
        }
      }
      extractedSections.push('');
    }

    return extractedSections.join('\n');
  }

  private findElementsBySelector(html: string, selector: string): string[] {
    const elements: string[] = [];
    
    try {
      // Handle different selector types
      if (selector.startsWith('#')) {
        // ID selector
        const id = selector.substring(1);
        const regex = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)</[^>]+>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null && elements.length < 5) {
          elements.push(match[0]);
        }
      } else if (selector.startsWith('.')) {
        // Class selector
        const className = selector.substring(1);
        const regex = new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)</[^>]+>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null && elements.length < 5) {
          elements.push(match[0]);
        }
      } else if (selector.startsWith('[') && selector.endsWith(']')) {
        // Attribute selector
        const attr = selector.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<[^>]+${attr}[^>]*>([\\s\\S]*?)</[^>]+>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null && elements.length < 5) {
          elements.push(match[0]);
        }
      } else if (selector.includes('-') || selector.includes('_')) {
        // Handle Angular/framework selectors that contain special characters
        const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`[^>]*${escapedSelector}[^>]*>([\\s\\S]*?)<`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null && elements.length < 5) {
          // Find the full tag by looking backwards and forwards
          const start = html.lastIndexOf('<', match.index);
          const end = html.indexOf('>', match.index) + 1;
          if (start !== -1 && end !== -1) {
            elements.push(html.substring(start, end));
          }
        }
      } else {
        // Tag selector
        const regex = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)</${selector}>`, 'gi');
        let match;
        while ((match = regex.exec(html)) !== null && elements.length < 5) {
          elements.push(match[0]);
        }
      }
    } catch (error) {
      // Fallback: just look for the selector string in the HTML
      if (html.includes(selector)) {
        elements.push(`<!-- Found "${selector}" but extraction failed: ${error} -->`);
      }
    }
    
    return elements;
  }

  private extractFallbackContent(html: string): string {
    const extractedSections: string[] = [];

    extractedSections.push('<!-- NO FRAMEWORK DETECTED: Using fallback extraction -->\n');

    // Always include head for context but remove large style blocks
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch) {
      let cleanHead = headMatch[0];
      // Remove inline <style> blocks but keep other head elements
      cleanHead = cleanHead.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<!-- <style> block removed -->');
      extractedSections.push('<!-- HEAD SECTION (styles removed) -->');
      extractedSections.push(cleanHead);
      extractedSections.push('');
    }

    // Try common semantic/structural elements
    const importantSelectors = [
      { name: 'Main Content', selectors: ['main', '[role="main"]', '#main', '.main'] },
      { name: 'Navigation', selectors: ['nav', '[role="navigation"]', '#nav', '.nav', '.navbar'] },
      { name: 'Header', selectors: ['header', '[role="banner"]', '#header', '.header'] },
      { name: 'App Container', selectors: ['#app', '#root', '.app', '.container'] },
      { name: 'Content Area', selectors: ['.content', '#content', '.page', '.wrapper'] }
    ];

    for (const group of importantSelectors) {
      for (const selector of group.selectors) {
        const elements = this.findElementsBySelector(html, selector);
        if (elements.length > 0) {
          extractedSections.push(`<!-- ${group.name.toUpperCase()}: Found ${elements.length} element(s) -->`);
          
          elements.slice(0, 2).forEach((element) => {
            // Clean up the element by removing inline styles and script tags
            let cleanElement = element;
            cleanElement = cleanElement.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<!-- <style> removed -->');
            cleanElement = cleanElement.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!-- <script> removed -->');
            
            // Truncate large elements
            if (cleanElement.length > 3000) {
              const truncated = cleanElement.substring(0, 3000);
              const remaining = element.length - 3000;
              extractedSections.push(truncated + `\n  <!-- TRUNCATED: ${remaining} more chars -->`);
            } else {
              extractedSections.push(cleanElement);
            }
          });
          
          if (elements.length > 2) {
            extractedSections.push(`<!-- ... and ${elements.length - 2} more ${selector} elements -->`);
          }
          extractedSections.push('');
          break; // Found elements for this group, move to next
        }
      }
    }

    // If no structural elements found, just grab the body
    if (extractedSections.length <= 2) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        extractedSections.push('<!-- BODY CONTENT (no structure detected) -->');
        const bodyContent = bodyMatch[1].substring(0, 5000);
        extractedSections.push(`<body>${bodyContent}${bodyMatch[1].length > 5000 ? '\n<!-- TRUNCATED: ' + (bodyMatch[1].length - 5000) + ' more chars -->' : ''}</body>`);
      }
    }

    return extractedSections.join('\n');
  }

  private truncateHtml(html: string, maxLength: number): string {
    if (html.length <= maxLength) {
      return html;
    }

    // Try to find a good truncation point (end of a tag)
    let truncateAt = maxLength;
    
    // Look backwards for the last complete tag before maxLength
    for (let i = maxLength; i > maxLength - 500 && i > 0; i--) {
      if (html[i] === '>' && html[i - 1] !== '/') {
        truncateAt = i + 1;
        break;
      }
    }

    const truncated = html.substring(0, truncateAt);
    const remainingLines = html.substring(truncateAt).split('\n').length;
    
    return truncated + `\n\n<!-- TRUNCATED: ${remainingLines} more lines (${html.length - truncateAt} chars) -->`;
  }

  getSchema() {
    return {
      name: 'get_dom_snapshot',
      description: 'Get a snapshot of the current page DOM. ESSENTIAL: Use this tool before click_element or type_text to inspect page structure, find correct element selectors, and identify dynamic IDs. This prevents selector failures and ensures reliable automation. Example: get_dom_snapshot → find button selector → click_element.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: {
            type: 'number',
            description: 'Tab ID to get DOM from (uses current active tab if not specified)',
            optional: true
          },
          includeStyles: {
            type: 'boolean',
            description: 'Include computed styles in the snapshot (default: false)',
            default: false,
            optional: true
          },
          selector: {
            type: 'string',
            description: 'CSS selector to capture specific element (captures full document if not specified). Common patterns: "button" for buttons, "input[type=\'password\']" for password fields, "[data-testid=\'login\']" for test elements.',
            optional: true
          },
          maxLength: {
            type: 'number',
            description: 'Maximum HTML content length to return (default: 10000 chars)',
            default: 10000,
            optional: true
          },
          smartExtraction: {
            type: 'boolean',
            description: 'Enable intelligent framework detection and extraction (default: true)',
            default: true,
            optional: true
          }
        }
      }
    };
  }

  async execute(args: unknown): Promise<CallToolResult> {
    try {
      const params = GetDomSnapshotSchema.parse(args || {});

      const isConnected = await this.bridge.isExtensionConnected();
      if (!isConnected) {
        return {
          content: [{ type: 'text', text: 'Chrome extension is not connected. Please ensure the Enhanced Browser MCP extension is installed and running.' }],
          isError: true,
        };
      }

      const result = await this.bridge.sendCommand('get_dom_snapshot', params);

      if (result.success) {
        const data = result.data;
        let responseText = `**DOM Snapshot** (Tab ${data.tabId})\n\n`;
        
        if (params.selector) {
          responseText += `**Selector:** ${params.selector}\n`;
        } else {
          responseText += `**Full Document Snapshot**\n`;
        }
        
        responseText += `**URL:** ${data.url}\n`;
        responseText += `**Title:** ${data.title}\n`;
        responseText += `**Original HTML Size:** ${Math.round(data.html.length / 1024)}KB\n`;
        
        if (data.elementCount !== undefined) {
          responseText += `**Elements Found:** ${data.elementCount}\n`;
        }

        let processedHtml = data.html;
        let extractionMethod = 'Raw HTML';

        // Try intelligent extraction if enabled and no specific selector
        if (params.smartExtraction && !params.selector) {
          const framework = this.detectFramework(data.html);
          
          if (framework) {
            responseText += `**Framework Detected:** ${framework.name}${framework.version ? ' v' + framework.version : ''} (${Math.round(framework.confidence * 100)}% confidence)\n`;
            responseText += `**Detection Indicators:** ${framework.indicators.join(', ')}\n`;
            
            processedHtml = this.extractFrameworkCore(data.html, framework);
            extractionMethod = `${framework.name} Smart Extraction`;
          } else {
            responseText += `**Framework Detection:** None detected, using fallback extraction\n`;
            processedHtml = this.extractFallbackContent(data.html);
            extractionMethod = 'Fallback Smart Extraction';
          }
        } else if (!params.smartExtraction) {
          responseText += `**Framework Detection:** Disabled\n`;
        }

        // Apply final truncation if still too large
        const maxLength = params.maxLength ?? 10000;
        const finalHtml = this.truncateHtml(processedHtml, maxLength);
        const wasTruncated = finalHtml.length < data.html.length;
        
        responseText += `**Extraction Method:** ${extractionMethod}\n`;
        responseText += `**Display HTML Size:** ${Math.round(finalHtml.length / 1024)}KB${wasTruncated ? ' (truncated)' : ''}\n`;
        
        responseText += `\n**HTML Content:**\n\`\`\`html\n${finalHtml}\n\`\`\``;
        
        return {
          content: [{ type: 'text', text: responseText }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to get DOM snapshot: ${result.error || 'Unknown error'}` }],
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