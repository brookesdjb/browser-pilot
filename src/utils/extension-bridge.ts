// Bridge to communicate with Chrome extension via WebSocket

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

interface ConsoleLog {
  id: string;
  tabId: number;
  level: string;
  message: string;
  timestamp: number;
  url: string;
  lineNumber: number;
}

interface TabLogData {
  tabId: number;
  tabTitle?: string;
  tabUrl?: string;
  logs: ConsoleLog[];
  totalCount: number;
}

interface WebSocketMessage {
  type: 'console_log' | 'tab_info' | 'heartbeat' | 'command' | 'command_response' | 'navigation_event' | 'network_request';
  data: any;
  id?: string; // For request/response correlation
  commandId?: string; // For navigation event correlation
}

interface NavigationState {
  commandId: string;
  requestedUrl: string;
  events: Array<{ event: string; url?: string; status?: string; timestamp: number; [key: string]: any }>;
  lastStableUrl: string | null;
  lastStableTime: number | null;
  stabilityTimer: ReturnType<typeof setTimeout> | null;
}

interface NetworkRequest {
  id: string;
  tabId: number;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timing?: {
    startTime: number;
    duration?: number;
  };
  responseSize?: number;
  timestamp: number;
  type: string; // xhr, fetch, document, etc.
}

export class ExtensionBridge {
  private sessionId: string;
  private logFilePath: string;
  private debugLogFilePath: string;
  private wsLogFilePath: string | null = null;
  private wsServer: WebSocketServer | null = null;
  private wsPort: number = 8899;
  private connectedClients: Set<WebSocket> = new Set();
  private extensionClients: Set<WebSocket> = new Set();
  private debugClients: Set<WebSocket> = new Set();
  private logs: ConsoleLog[] = [];
  private networkRequests: Map<number, NetworkRequest[]> = new Map(); // tabId -> requests
  private tabInfo: Map<number, { title: string; url: string }> = new Map();
  private maxLogs: number = 1000;
  private maxNetworkRequests: number = 500;
  private pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  private activeNavigations: Map<string, NavigationState> = new Map();
  private readonly STABILITY_TIMEOUT = 1500; // 1.5 seconds of stability required

  constructor(wsLogFilePath?: string) {
    this.sessionId = randomUUID();
    this.logFilePath = join(tmpdir(), `enhanced-browser-mcp-logs-${this.sessionId}.json`);
    this.debugLogFilePath = join(process.cwd(), `enhanced-browser-mcp-debug-${this.sessionId}.txt`);
    this.wsLogFilePath = wsLogFilePath || null;
    this.initializeWebSocketServer().catch(console.error);
    this.setupCleanup();
    this.testFilePermissions();
    this.debugLog('ExtensionBridge initialized', { sessionId: this.sessionId });
    
    if (this.wsLogFilePath) {
      this.logWebSocketMessage('SYSTEM', 'ExtensionBridge initialized with WebSocket logging');
    }
  }

  private async initializeWebSocketServer(): Promise<void> {
    try {
      this.wsServer = new WebSocketServer({ port: this.wsPort });
      
      this.wsServer.on('connection', (ws: WebSocket) => {
        console.error(`Client connected to WebSocket server on port ${this.wsPort}`);
        this.connectedClients.add(ws);
        
        let clientIdentified = false;

        ws.on('message', (data: Buffer) => {
          try {
            const message: WebSocketMessage = JSON.parse(data.toString());
            
            // Log incoming message
            this.logWebSocketMessage('INCOMING', message);
            
            // Identify client type on first meaningful message
            if (!clientIdentified) {
              if (message.type === 'console_log' || message.type === 'tab_info' || message.type === 'command_response' || message.type === 'navigation_event' || message.type === 'network_request') {
                this.extensionClients.add(ws);
                console.error('Identified as extension client');
              } else {
                this.debugClients.add(ws);
                console.error('Identified as debug client');
              }
              clientIdentified = true;
            }
            
            this.debugLog('WebSocket message received', { type: message.type, id: message.id, commandId: message.commandId });
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
            this.debugLog('Failed to parse WebSocket message', { error: (error as Error).message, rawData: data.toString() });
            // If we can't parse the message, assume it's a debug client
            if (!clientIdentified) {
              this.debugClients.add(ws);
              clientIdentified = true;
            }
          }
        });

        ws.on('close', () => {
          console.error('Client disconnected from WebSocket server');
          this.connectedClients.delete(ws);
          this.extensionClients.delete(ws);
          this.debugClients.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.connectedClients.delete(ws);
          this.extensionClients.delete(ws);
          this.debugClients.delete(ws);
        });

        // Send connection confirmation with version info
        ws.send(JSON.stringify({ 
          type: 'connection_confirmed', 
          sessionId: this.sessionId,
          serverVersion: '0.9.0'
        }));
      });

      console.error(`WebSocket server started on port ${this.wsPort}`);
    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
    }
  }

  private broadcastToDebugClients(message: WebSocketMessage): void {
    // Broadcast extension messages to debug clients only
    const debugMessage = {
      type: 'debug_relay',
      source: 'extension',
      timestamp: Date.now(),
      originalMessage: message
    };
    
    this.debugClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(debugMessage));
        } catch (error) {
          console.error('Failed to broadcast debug message:', error);
        }
      }
    });
  }

  private handleWebSocketMessage(message: WebSocketMessage): void {
    // Broadcast this message to debug clients
    this.broadcastToDebugClients(message);
    
    switch (message.type) {
      case 'console_log':
        this.addConsoleLog(message.data);
        break;
      case 'tab_info':
        this.updateTabInfo(message.data.tabId, message.data.title, message.data.url);
        break;
      case 'heartbeat':
        // Extension is alive
        break;
      case 'command_response':
        this.handleCommandResponse(message);
        break;
      case 'navigation_event':
        this.handleNavigationEvent(message);
        break;
      case 'network_request':
        this.addNetworkRequest(message.data);
        break;
    }
  }

  private handleCommandResponse(message: WebSocketMessage): void {
    if (!message.id) return;

    // Check if this is a navigation command - don't resolve immediately, let timeout handle it
    if (this.activeNavigations.has(message.id)) {
      this.debugLog('Received command response for active navigation, ignoring immediate resolution', { commandId: message.id });
      return;
    }

    const pending = this.pendingCommands.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(message.id);
      pending.resolve(message.data);
    }
  }

  private addConsoleLog(logData: ConsoleLog): void {
    // Add to in-memory logs
    this.logs.unshift(logData);

    // Keep only maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Persist to file
    this.persistLogsToFile().catch(console.error);
  }

  private addNetworkRequest(requestData: NetworkRequest): void {
    const { tabId } = requestData;
    
    // Initialize tab's request array if needed
    if (!this.networkRequests.has(tabId)) {
      this.networkRequests.set(tabId, []);
    }
    
    const tabRequests = this.networkRequests.get(tabId)!;
    
    // Check if this is an update to an existing request
    const existingIndex = tabRequests.findIndex(req => req.id === requestData.id);
    
    if (existingIndex !== -1) {
      // Update existing request
      tabRequests[existingIndex] = { ...tabRequests[existingIndex], ...requestData };
    } else {
      // Add new request at the beginning (most recent first)
      tabRequests.unshift(requestData);
      
      // Keep only maxNetworkRequests entries per tab
      if (tabRequests.length > this.maxNetworkRequests) {
        tabRequests.splice(this.maxNetworkRequests);
      }
    }
    
    this.debugLog('Network request added/updated', { 
      tabId, 
      requestId: requestData.id, 
      method: requestData.method, 
      url: requestData.url,
      status: requestData.status,
      totalRequests: tabRequests.length 
    });
  }

  private async persistLogsToFile(): Promise<void> {
    try {
      await fs.writeFile(this.logFilePath, JSON.stringify(this.logs, null, 2));
    } catch (error) {
      console.error('Failed to persist logs to file:', error);
    }
  }

  private updateTabInfo(tabId: number, title: string, url: string): void {
    this.tabInfo.set(tabId, { title, url });
  }

  private handleNavigationEvent(message: WebSocketMessage): void {
    if (!message.commandId) {
      this.debugLog('Navigation event missing commandId', message);
      return;
    }

    const commandId = message.commandId;
    const eventData = message.data;

    this.debugLog('Navigation event received', { commandId, event: eventData.event, url: eventData.url, status: eventData.status });

    // Initialize navigation state if needed
    if (!this.activeNavigations.has(commandId)) {
      if (eventData.event === 'navigation_started') {
        const navigationState: NavigationState = {
          commandId,
          requestedUrl: eventData.requestedUrl,
          events: [],
          lastStableUrl: null,
          lastStableTime: null,
          stabilityTimer: null
        };
        this.activeNavigations.set(commandId, navigationState);
        this.debugLog('Navigation state initialized', { commandId, requestedUrl: eventData.requestedUrl });
        
        // Start simple 2-second timeout
        navigationState.stabilityTimer = setTimeout(() => {
          this.debugLog('2-second timeout reached, completing navigation', { commandId });
          this.completeNavigationWithTimeout(commandId);
        }, 2000);
      } else {
        console.error(`Received ${eventData.event} without navigation_started for command ${commandId}`);
        this.debugLog('Navigation event without navigation_started', { commandId, event: eventData.event });
        return;
      }
    }

    const navigationState = this.activeNavigations.get(commandId)!;
    
    // Add event to history
    const eventWithTimestamp = {
      event: eventData.event,
      url: eventData.url,
      status: eventData.status,
      timestamp: eventData.timestamp,
      ...eventData
    };
    navigationState.events.push(eventWithTimestamp);

    this.debugLog('Event added to navigation state', { 
      commandId, 
      eventCount: navigationState.events.length,
      event: eventWithTimestamp 
    });

    console.error(`Navigation event: ${eventData.event} - ${eventData.url || eventData.status || ''}`);

    // Update last stable URL if we get a URL change
    if (eventData.event === 'url_changed' && eventData.url) {
      navigationState.lastStableUrl = eventData.url;
      navigationState.lastStableTime = Date.now();
      this.debugLog('Updated last stable URL', { commandId, url: eventData.url });
    }

    // Clear network requests on navigation start (new page load)
    if (eventData.event === 'navigation_started' && eventData.tabId) {
      this.networkRequests.delete(eventData.tabId);
      this.debugLog('Cleared network requests for new navigation', { tabId: eventData.tabId, commandId });
    }

    // Handle navigation errors immediately
    if (eventData.event === 'navigation_error') {
      this.completeNavigation(commandId, false, eventData.error);
    }
  }

  private completeNavigationWithTimeout(commandId: string): void {
    const navigationState = this.activeNavigations.get(commandId);
    if (!navigationState) {
      this.debugLog('completeNavigationWithTimeout: no navigation state found', { commandId });
      return;
    }

    this.debugLog('Completing navigation after timeout', { 
      commandId, 
      eventCount: navigationState.events.length,
      lastStableUrl: navigationState.lastStableUrl 
    });

    // Get current tab state
    this.sendCommand('get_current_url', {}, 1000)
      .then((currentState) => {
        this.debugLog('Got current tab state', { commandId, currentState });
        
        // Build navigation result with current state
        const result = this.buildNavigationResult(navigationState, currentState);
        
        // Complete the pending command
        const pending = this.pendingCommands.get(commandId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(commandId);
          this.debugLog('Resolving pending command with timeout result', { commandId });
          pending.resolve(result);
        } else {
          this.debugLog('No pending command found for timeout completion', { commandId, pendingCount: this.pendingCommands.size });
        }

        // Clean up navigation state
        this.activeNavigations.delete(commandId);

        // Clean up extension listener
        this.sendCommand('cleanup_navigation', { commandId }, 1000).catch(() => {
          // Ignore cleanup errors
        });
      })
      .catch((error) => {
        this.debugLog('Failed to get current state, completing with stored data', { commandId, error: error.message });
        
        // Fallback to stored navigation data
        const result = this.buildNavigationResult(navigationState, null);
        
        const pending = this.pendingCommands.get(commandId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(commandId);
          pending.resolve(result);
        }

        this.activeNavigations.delete(commandId);
        this.sendCommand('cleanup_navigation', { commandId }, 1000).catch(() => {});
      });
  }

  private buildNavigationResult(navigationState: NavigationState, currentState: any): any {
    // Build redirect chain from events
    const redirectChain = [navigationState.requestedUrl];
    const urlEvents = navigationState.events.filter(e => e.event === 'url_changed' && e.url);
    
    for (const event of urlEvents) {
      if (event.url && event.url !== redirectChain[redirectChain.length - 1]) {
        redirectChain.push(event.url);
      }
    }

    // Determine final URL - prefer current state, then lastStableUrl, then last event URL, then requested URL
    let finalUrl = currentState?.url || navigationState.lastStableUrl;
    if (!finalUrl) {
      const lastUrlEvent = navigationState.events.filter(e => e.url).pop();
      finalUrl = lastUrlEvent?.url || navigationState.requestedUrl;
    }

    // Ensure final URL is in redirect chain
    if (finalUrl && finalUrl !== redirectChain[redirectChain.length - 1]) {
      redirectChain.push(finalUrl);
    }

    const navigationTime = navigationState.events.length > 0 ? 
      Date.now() - navigationState.events[0].timestamp : 0;

    // Get final title - prefer current state, then last title event
    let finalTitle = currentState?.title;
    if (!finalTitle) {
      const titleEvent = navigationState.events.filter(e => e.title).pop();
      finalTitle = titleEvent?.title || 'Unknown Title';
    }

    const result = {
      success: true,
      data: {
        requestedUrl: navigationState.requestedUrl,
        finalUrl,
        finalTitle,
        redirectChain,
        redirectCount: redirectChain.length - 1,
        navigationTimeMs: navigationTime,
        tabId: currentState?.tabId || navigationState.events.find(e => e.tabId)?.tabId,
        events: navigationState.events,
        currentState // Include current state for LLM analysis
      }
    };

    return result;
  }

  private completeNavigation(commandId: string, success: boolean, error?: string): void {
    const navigationState = this.activeNavigations.get(commandId);
    if (!navigationState) {
      this.debugLog('completeNavigation: no navigation state found', { commandId });
      return;
    }

    this.debugLog('Completing navigation (error case)', { 
      commandId, 
      success, 
      error, 
      eventCount: navigationState.events.length 
    });

    // Clear stability timer
    if (navigationState.stabilityTimer) {
      clearTimeout(navigationState.stabilityTimer);
    }

    const result = {
      success,
      error,
      data: success ? this.buildNavigationResult(navigationState, null).data : undefined
    };

    // Complete the pending command
    const pending = this.pendingCommands.get(commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(commandId);
      this.debugLog('Resolving pending command', { commandId });
      pending.resolve(result);
    } else {
      this.debugLog('No pending command found', { commandId, pendingCount: this.pendingCommands.size });
    }

    // Clean up navigation state
    this.activeNavigations.delete(commandId);

    // Clean up extension listener
    this.sendCommand('cleanup_navigation', { commandId }, 1000).catch(() => {
      // Ignore cleanup errors
    });
  }

  private async testFilePermissions(): Promise<void> {
    try {
      const testFilePath = join(process.cwd(), `enhanced-browser-mcp-startup-${this.sessionId}.txt`);
      await fs.writeFile(testFilePath, `MCP Server started at ${new Date().toISOString()}\nSession ID: ${this.sessionId}\n`);
      console.error(`Startup file written successfully: ${testFilePath}`);
    } catch (error) {
      console.error('Failed to write startup file - file permissions issue:', error);
    }
  }

  private async logWebSocketMessage(direction: string, message: any): Promise<void> {
    if (!this.wsLogFilePath) return;
    
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `\n[${timestamp}] ${direction}: ${typeof message === 'string' ? message : JSON.stringify(message, null, 2)}\n`;
      await fs.appendFile(this.wsLogFilePath, logEntry);
    } catch (error) {
      console.error('Failed to log WebSocket message:', error);
    }
  }

  private async debugLog(message: string, data?: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n\n`;
    
    try {
      await fs.appendFile(this.debugLogFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
  }

  private setupCleanup(): void {
    const cleanup = async () => {
      console.error('Cleaning up extension bridge...');
      
      // Close WebSocket server
      if (this.wsServer) {
        this.wsServer.close();
      }

      // Clean up session files
      try {
        await fs.unlink(this.logFilePath);
      } catch (error) {
        // File might not exist, ignore
      }
      
      try {
        await fs.unlink(this.debugLogFilePath);
      } catch (error) {
        // File might not exist, ignore
      }

      // Clean up old session files (older than 1 hour)
      try {
        const tempDir = tmpdir();
        const files = await fs.readdir(tempDir);
        const mcpLogFiles = files.filter(f => 
          f.startsWith('enhanced-browser-mcp-logs-') || 
          f.startsWith('enhanced-browser-mcp-debug-')
        );
        
        for (const file of mcpLogFiles) {
          const filePath = join(tempDir, file);
          try {
            const stats = await fs.stat(filePath);
            const ageMs = Date.now() - stats.mtime.getTime();
            if (ageMs > 3600000) { // 1 hour
              await fs.unlink(filePath);
              console.error(`Cleaned up old log file: ${file}`);
            }
          } catch (error) {
            // File might have been deleted already
          }
        }
      } catch (error) {
        console.error('Error cleaning up old files:', error);
      }
    };

    // Clean up on process exit
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }

  async getNetworkRequests(params: any = {}): Promise<any> {
    const { tabId, limit = 50, method, status, since } = params;
    
    // Determine target tab
    let targetTabId = tabId;
    if (!targetTabId && this.extensionClients.size > 0) {
      // Use the most recently active tab with requests
      const tabsWithRequests = Array.from(this.networkRequests.keys());
      targetTabId = tabsWithRequests[0] || null;
    }
    
    if (!targetTabId) {
      return {
        tabId: null,
        totalCount: 0,
        requests: [],
        since: since || null
      };
    }
    
    const tabRequests = this.networkRequests.get(targetTabId) || [];
    let filteredRequests = [...tabRequests];
    
    // Apply filters
    if (method) {
      filteredRequests = filteredRequests.filter(req => 
        req.method.toLowerCase() === method.toLowerCase()
      );
    }
    
    if (status) {
      filteredRequests = filteredRequests.filter(req => req.status === status);
    }
    
    if (since) {
      filteredRequests = filteredRequests.filter(req => req.timestamp >= since);
    }
    
    // Apply limit
    const requests = filteredRequests.slice(0, limit);
    
    return {
      tabId: targetTabId,
      totalCount: filteredRequests.length,
      requests,
      since: since || null
    };
  }

  async getConsoleLogs(params: any = {}): Promise<TabLogData[]> {
    try {
      // If we have WebSocket connections, use real-time data
      if (this.connectedClients.size > 0) {
        return this.groupLogsByTab(this.logs, params);
      }

      // Try to read from session file
      const logs = await this.readLogsFromFile(params);
      if (logs.length > 0) {
        return this.groupLogsByTab(logs, params);
      }

      // Fallback to mock data
      console.warn('Extension not connected, using mock data');
      return this.generateMockTabLogs(params);

    } catch (error) {
      console.error('Failed to get console logs:', error);
      return this.generateMockTabLogs(params);
    }
  }

  private async readLogsFromFile(params: any): Promise<ConsoleLog[]> {
    try {
      const data = await fs.readFile(this.logFilePath, 'utf-8');
      const logs = JSON.parse(data) as ConsoleLog[];
      
      // Apply filters
      let filteredLogs = logs;
      
      if (params.tabId) {
        filteredLogs = filteredLogs.filter(log => log.tabId === params.tabId);
      }
      
      if (params.level) {
        filteredLogs = filteredLogs.filter(log => log.level === params.level);
      }
      
      if (params.since) {
        filteredLogs = filteredLogs.filter(log => log.timestamp >= params.since);
      }
      
      return filteredLogs.slice(0, params.limit || 50);
      
    } catch (error) {
      return [];
    }
  }

  private groupLogsByTab(logs: ConsoleLog[], params: any): TabLogData[] {
    const tabGroups = new Map<number, ConsoleLog[]>();
    
    // Group logs by tabId
    logs.forEach(log => {
      if (!tabGroups.has(log.tabId)) {
        tabGroups.set(log.tabId, []);
      }
      tabGroups.get(log.tabId)!.push(log);
    });
    
    // Convert to TabLogData format
    const result: TabLogData[] = [];
    tabGroups.forEach((tabLogs, tabId) => {
      const limit = params.limit || 50;
      const displayLogs = tabLogs.slice(0, limit);
      
      // Get tab info from stored data or derive from URL
      const tabInfo = this.tabInfo.get(tabId);
      const tabTitle = tabInfo?.title || this.getTabTitle(tabLogs[0]?.url);
      const tabUrl = tabInfo?.url || tabLogs[0]?.url;
      
      result.push({
        tabId,
        tabTitle,
        tabUrl,
        logs: displayLogs,
        totalCount: tabLogs.length
      });
    });
    
    return result.sort((a, b) => a.tabId - b.tabId);
  }

  private getTabTitle(url?: string): string {
    if (!url) return 'Unknown Tab';
    try {
      const urlObj = new URL(url);
      return urlObj.hostname || 'Unknown Tab';
    } catch {
      return 'Unknown Tab';
    }
  }

  private generateMockTabLogs(params: any): TabLogData[] {
    const levels = ['log', 'info', 'warn', 'error', 'debug'];
    const messages = [
      'Page loaded successfully',
      'API request completed', 
      'Warning: deprecated function used',
      'Error: network timeout',
      'Debug: processing user input'
    ];

    const tabs = [
      { id: 1, title: 'example.com', url: 'https://example.com' },
      { id: 2, title: 'github.com', url: 'https://github.com' },
      { id: 3, title: 'localhost:3000', url: 'http://localhost:3000' }
    ];

    const result: TabLogData[] = [];

    tabs.forEach(tab => {
      const logCount = Math.floor(Math.random() * 10) + 1;
      const logs: ConsoleLog[] = [];

      for (let i = 0; i < logCount; i++) {
        logs.push({
          id: `log-${tab.id}-${i}`,
          tabId: tab.id,
          level: levels[Math.floor(Math.random() * levels.length)],
          message: messages[Math.floor(Math.random() * messages.length)],
          timestamp: Date.now() - (i * 1000),
          url: tab.url,
          lineNumber: Math.floor(Math.random() * 100) + 1
        });
      }

      // Apply filters if specified
      let filteredLogs = logs;
      
      if (params.tabId && tab.id !== params.tabId) {
        return; // Skip this tab
      }
      
      if (params.level) {
        filteredLogs = filteredLogs.filter(log => log.level === params.level);
      }
      
      if (params.since) {
        filteredLogs = filteredLogs.filter(log => log.timestamp >= params.since);
      }

      const limit = params.limit || 50;
      const displayLogs = filteredLogs.slice(0, limit);

      if (displayLogs.length > 0) {
        result.push({
          tabId: tab.id,
          tabTitle: tab.title,
          tabUrl: tab.url,
          logs: displayLogs,
          totalCount: logs.length
        });
      }
    });

    return result;
  }

  async isExtensionConnected(): Promise<boolean> {
    return this.extensionClients.size > 0;
  }

  getWebSocketPort(): number {
    return this.wsPort;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getDebugLogPath(): string {
    return this.debugLogFilePath;
  }

  async sendCommand(command: string, params: any = {}, timeout: number = 10000): Promise<any> {
    // Handle network requests locally if we have cached data
    if (command === 'get_network_requests') {
      const result = await this.getNetworkRequests(params);
      return { success: true, data: result };
    }

    return new Promise((resolve, reject) => {
      if (this.extensionClients.size === 0) {
        reject(new Error('No extension clients connected'));
        return;
      }

      const commandId = randomUUID();
      const message: WebSocketMessage = {
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

      // Send command to extension clients only
      this.extensionClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          // Log outgoing message
          this.logWebSocketMessage('OUTGOING', message);
          client.send(JSON.stringify(message));
        }
      });
    });
  }
}