/**
 * Browser Pilot MCP Client
 * 
 * This module connects to the Browser Pilot Native Messaging Host (broker)
 * to interact with the Chrome extension. It replaces the WebSocket client
 * in the original enhanced-browser-mcp implementation.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { BrowserInterface, TabLogData } from '../types/browser-interface.js';
import type { GetConsoleLogsParams } from '../types/console.js';

// Types
interface BrowserPilotOptions {
  debug?: boolean;
  logFilePath?: string;
  connectionTimeout?: number;
}

interface Command {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class BrowserPilotClient implements BrowserInterface {
  private clientId: string;
  private ws: WebSocket | null = null;
  private wsUrl: string = 'ws://localhost:9876'; // Default port for the native host broker
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingCommands: Map<string, Command> = new Map();
  public debug: boolean = false; // Changed to public
  private logFilePath: string;
  private connectionTimeout: number;
  
  constructor(options: BrowserPilotOptions = {}) {
    this.clientId = randomUUID();
    this.debug = options.debug || false;
    this.connectionTimeout = options.connectionTimeout || 10000;
    
    // Set up log file
    this.logFilePath = options.logFilePath || join(os.tmpdir(), `browser-pilot-client-${this.clientId}.log`);
    this.log('Browser Pilot Client initialized', { clientId: this.clientId });
  }
  
  /**
   * Connect to the Browser Pilot native host broker
   */
  async connect(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.log('Connecting to Browser Pilot native host broker...');
        this.ws = new WebSocket(this.wsUrl);
        
        // Set connection timeout
        const connectionTimeout = setTimeout(() => {
          this.log('Connection timeout');
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }, this.connectionTimeout);
        
        this.ws.on('open', () => {
          clearTimeout(connectionTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.log('Connected to Browser Pilot native host broker');
          resolve(true);
        });
        
        this.ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            this.log('Failed to parse message from WebSocket', { error: (error as Error).message });
          }
        });
        
        this.ws.on('close', () => {
          this.connected = false;
          this.log('WebSocket connection closed');
          
          // Reject all pending commands
          this.rejectAllPendingCommands('WebSocket connection closed');
          
          // Try to reconnect
          this.scheduleReconnect();
        });
        
        this.ws.on('error', (error) => {
          this.log('WebSocket error', { error: error.message });
          
          // Connection will be closed after error, which will trigger reconnect
        });
        
      } catch (error) {
        this.log('Failed to connect', { error: (error as Error).message });
        this.scheduleReconnect();
        reject(error);
      }
    });
  }
  
  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
      
      this.log('Scheduling reconnect', { 
        attempt: this.reconnectAttempts, 
        maxAttempts: this.maxReconnectAttempts,
        delay 
      });
      
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(() => {
          // Reconnect failure is handled by connect() method
        });
      }, delay);
    } else {
      this.log('Max reconnect attempts reached, giving up');
    }
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    if (!message || !message.type) {
      this.log('Invalid message received', { message });
      return;
    }
    
    this.log('Received message', { type: message.type, id: message.id });
    
    switch (message.type) {
      case 'connected':
        this.handleConnectedMessage(message);
        break;
        
      case 'command_response':
        this.handleCommandResponse(message);
        break;
        
      case 'navigation_event':
        this.handleNavigationEvent(message);
        break;
        
      case 'host_shutting_down':
        this.log('Native host shutting down');
        // Will reconnect when the connection is closed
        break;
        
      case 'extension_disconnected':
        this.log('Extension disconnected');
        // Native host will handle reconnecting to the extension
        break;
        
      default:
        this.log('Unhandled message type', { type: message.type });
    }
  }
  
  /**
   * Handle connected message from the native host
   */
  private handleConnectedMessage(message: any): void {
    this.log('Received connected message', { 
      clientId: message.data?.clientId,
      extensionConnected: message.data?.extensionConnected,
      version: message.data?.version
    });
    
    // Reset reconnect attempts on successful connection
    this.reconnectAttempts = 0;
  }
  
  /**
   * Handle command response from the native host
   */
  private handleCommandResponse(message: any): void {
    const commandId = message.id;
    if (!commandId) {
      this.log('Command response missing ID', { message });
      return;
    }
    
    const pendingCommand = this.pendingCommands.get(commandId);
    if (pendingCommand) {
      clearTimeout(pendingCommand.timeout);
      this.pendingCommands.delete(commandId);
      
      if (message.data && message.data.success === false) {
        pendingCommand.reject(new Error(message.data.error || 'Command failed'));
      } else {
        pendingCommand.resolve(message.data);
      }
    } else {
      this.log('No pending command found for response', { commandId });
    }
  }
  
  /**
   * Handle navigation event from the native host
   */
  private handleNavigationEvent(message: any): void {
    const commandId = message.commandId;
    if (!commandId) {
      this.log('Navigation event missing commandId', { message });
      return;
    }
    
    this.log('Navigation event', { 
      commandId, 
      event: message.data?.event,
      url: message.data?.url,
      status: message.data?.status
    });
    
    // Implementation-specific navigation handling can be added here
  }
  
  /**
   * Send a command to the native host with timeout
   */
  async sendCommand<T = any>(command: string, params: Record<string, any> = {}, timeout: number = 30000): Promise<T> {
    // Connect if not connected
    if (!this.connected) {
      await this.connect();
    }
    
    return new Promise<T>((resolve, reject) => {
      try {
        // Skip if not connected
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Not connected to Browser Pilot native host'));
          return;
        }
        
        // Generate unique command ID
        const commandId = randomUUID();
        
        // Create message
        const message = {
          type: 'command',
          id: commandId,
          data: {
            command,
            params
          }
        };
        
        // Set up timeout
        const timeoutHandle = setTimeout(() => {
          this.pendingCommands.delete(commandId);
          reject(new Error(`Command ${command} timed out after ${timeout}ms`));
        }, timeout);
        
        // Store pending command
        this.pendingCommands.set(commandId, {
          resolve,
          reject,
          timeout: timeoutHandle
        });
        
        // Send command
        this.ws.send(JSON.stringify(message));
        this.log('Sent command', { command, commandId, paramsKeys: Object.keys(params) });
        
      } catch (error) {
        this.log('Error sending command', { command, error: (error as Error).message });
        reject(error);
      }
    });
  }
  
  /**
   * Reject all pending commands with an error
   */
  private rejectAllPendingCommands(errorMessage: string): void {
    const pendingCount = this.pendingCommands.size;
    if (pendingCount > 0) {
      this.log('Rejecting all pending commands', { count: pendingCount, reason: errorMessage });
      
      this.pendingCommands.forEach((command, id) => {
        clearTimeout(command.timeout);
        command.reject(new Error(errorMessage));
      });
      
      this.pendingCommands.clear();
    }
  }
  
  /**
   * Check if connected to the native host
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Close the connection to the native host
   */
  async close(): Promise<void> {
    this.log('Closing Browser Pilot client connection');
    
    // Clear reconnect timer if any
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Reject all pending commands
    this.rejectAllPendingCommands('Connection closed by client');
    
    // Close WebSocket connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connected = false;
  }
  
  /**
   * Log to file if debug is enabled
   */
  private async log(message: string, data?: any): Promise<void> {
    if (this.debug) {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
      
      console.log(`[Browser Pilot] ${message}`, data);
      
      try {
        await fs.appendFile(this.logFilePath, logEntry);
      } catch (error) {
        // Ignore file write errors in logging
      }
    }
  }
  
  /**
   * Get console logs from the browser
   */
  async getConsoleLogs(params: GetConsoleLogsParams): Promise<TabLogData[]> {
    const result = await this.sendCommand('get_console_logs', params);
    if (!result || !result.success || !result.data || !result.data.success || !result.data.data) {
      return [];
    }
    
    // Extract the actual logs array from the nested structure
    const logs = result.data.data;
    if (!Array.isArray(logs)) {
      return [];
    }
    
    // Group logs by tab ID and format as TabLogData
    const logsByTab = new Map<number, any[]>();
    logs.forEach((log: any) => {
      if (!logsByTab.has(log.tabId)) {
        logsByTab.set(log.tabId, []);
      }
      logsByTab.get(log.tabId)!.push(log);
    });
    
    // Convert to TabLogData format
    const tabLogData: TabLogData[] = [];
    for (const [tabId, logs] of logsByTab) {
      tabLogData.push({
        tabId,
        tabTitle: logs[0]?.tabTitle || `Tab ${tabId}`,
        tabUrl: logs[0]?.tabUrl || 'Unknown URL',
        logs,
        totalCount: logs.length
      });
    }
    
    return tabLogData;
  }

  // ===== MCP API Methods =====
  
  /**
   * Navigate to a URL
   */
  async navigateToUrl(url: string, options: { tabId?: number; timeout?: number } = {}): Promise<any> {
    return this.sendCommand('navigate_to_url', {
      url,
      tabId: options.tabId,
      timeout: options.timeout || 30000
    });
  }
  
  /**
   * Get current URL
   */
  async getCurrentUrl(options: { tabId?: number } = {}): Promise<any> {
    return this.sendCommand('get_current_url', {
      tabId: options.tabId
    });
  }
  
  /**
   * Get localStorage contents
   */
  async getLocalStorage(options: { tabId?: number } = {}): Promise<any> {
    return this.sendCommand('get_local_storage', {
      tabId: options.tabId
    });
  }
  
  /**
   * Get sessionStorage contents
   */
  async getSessionStorage(options: { tabId?: number } = {}): Promise<any> {
    return this.sendCommand('get_session_storage', {
      tabId: options.tabId
    });
  }
  
  /**
   * Get cookies
   */
  async getCookies(options: { tabId?: number } = {}): Promise<any> {
    return this.sendCommand('get_cookies', {
      tabId: options.tabId
    });
  }
  
  /**
   * Get DOM snapshot
   */
  async getDomSnapshot(options: { tabId?: number; selector?: string; includeStyles?: boolean } = {}): Promise<any> {
    return this.sendCommand('get_dom_snapshot', {
      tabId: options.tabId,
      selector: options.selector,
      includeStyles: options.includeStyles || false
    });
  }
  
  /**
   * Take screenshot
   */
  async takeScreenshot(options: { 
    tabId?: number; 
    fullPage?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
    selector?: string;
  } = {}): Promise<any> {
    return this.sendCommand('take_screenshot', {
      tabId: options.tabId,
      fullPage: options.fullPage || false,
      format: options.format || 'png',
      quality: options.quality || 90,
      selector: options.selector
    });
  }
  
  /**
   * Click an element
   */
  async clickElement(options: { 
    tabId?: number;
    selector?: string;
    text?: string;
  } = {}): Promise<any> {
    if (!options.selector && !options.text) {
      throw new Error('Either selector or text must be provided');
    }
    
    return this.sendCommand('click_element', {
      tabId: options.tabId,
      selector: options.selector,
      text: options.text
    });
  }
  
  /**
   * Type text into an element
   */
  async typeText(options: {
    tabId?: number;
    selector?: string;
    text?: string;
    textToType: string;
    clearFirst?: boolean;
    submit?: boolean;
  }): Promise<any> {
    if (!options.selector && !options.text) {
      throw new Error('Either selector or text must be provided');
    }
    
    if (!options.textToType) {
      throw new Error('Text to type must be provided');
    }
    
    return this.sendCommand('type_text', {
      tabId: options.tabId,
      selector: options.selector,
      text: options.text,
      textToType: options.textToType,
      clearFirst: options.clearFirst !== false, // Default to true
      submit: options.submit || false
    });
  }
}

// Export singleton instance for easy import
export default new BrowserPilotClient();