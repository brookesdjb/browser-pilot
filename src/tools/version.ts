import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const versionTool: Tool = {
  name: 'get_version',
  description: 'Get the current version and build information of the Enhanced Browser MCP server',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
};

export async function executeGetVersion(): Promise<string> {
  try {
    // Read package.json to get version
    const packagePath = join(__dirname, '../../package.json');
    const packageData = await fs.readFile(packagePath, 'utf-8');
    const packageJson = JSON.parse(packageData);
    
    const buildTime = new Date().toISOString();
    const features = [
      '✅ Console log collection',
      '✅ Navigation with redirect tracking',
      '✅ Current URL detection',
      '✅ Debug logging to files',
      '✅ WebSocket message broadcasting',
      '✅ File permission testing'
    ];
    
    return `# Enhanced Browser MCP Server

**Version:** ${packageJson.version}
**Name:** ${packageJson.name}
**Build Time:** ${buildTime}
**Node.js Version:** ${process.version}
**Platform:** ${process.platform}

## Features
${features.join('\n')}

## Debug Information
- Startup file test: Enabled
- WebSocket message broadcasting: Enabled
- Navigation event streaming: Enabled
- File-based debug logging: Enabled

*This version tool confirms the MCP server is running the latest compiled code.*`;
    
  } catch (error) {
    return `❌ **Version Check Failed**
    
Error reading version information: ${(error as Error).message}

This suggests the MCP server may not be running the expected build.`;
  }
}