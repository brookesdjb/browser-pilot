/**
 * BrowserInterface defines the common methods needed by tools
 * This allows us to swap between ExtensionBridge and BrowserPilotClient
 */

// Import types needed for tools
import { GetConsoleLogsParams } from './console.js';

// Define TabLogData interface
export interface TabLogData {
  tabId: number;
  tabTitle?: string;
  tabUrl?: string;
  logs: any[];
  totalCount: number;
}

export interface BrowserInterface {
  sendCommand(command: string, params: any, timeout?: number): Promise<any>;
  isConnected(): Promise<boolean> | boolean;
  getConsoleLogs(params: GetConsoleLogsParams): Promise<TabLogData[]>;
}