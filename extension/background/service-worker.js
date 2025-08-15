// Enhanced Browser MCP - Background Service Worker
// Handles console log collection via Chrome debugger API

class ConsoleLogCollector {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.attachedTabs = new Set();
    this.wsConnection = null;
    this.wsUrl = 'ws://localhost:8899';
    this.reconnectInterval = 5000; // 5 seconds
    this.reconnectTimer = null;
    
    this.connectToMcpServer();
    this.setupTabListeners();
  }
  
  async connectToMcpServer() {
    try {
      console.log('Connecting to MCP WebSocket server...');
      this.wsConnection = new WebSocket(this.wsUrl);
      
      this.wsConnection.onopen = () => {
        console.log('Connected to MCP WebSocket server');
        // Clear reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };
      
      this.wsConnection.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'connection_confirmed') {
            console.log('MCP server connection confirmed, sessionId:', message.sessionId);
          } else if (message.type === 'command') {
            this.handleCommand(message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      this.wsConnection.onclose = () => {
        console.log('Disconnected from MCP WebSocket server, will retry...');
        this.wsConnection = null;
        this.scheduleReconnect();
      };
      
      this.wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.wsConnection = null;
        this.scheduleReconnect();
      };
      
    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      this.scheduleReconnect();
    }
  }
  
  scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.connectToMcpServer();
      }, this.reconnectInterval);
    }
  }
  
  sendToMcpServer(message) {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(message));
    }
  }
  
  async handleCommand(message) {
    const { command, params } = message.data;
    const commandId = message.id;
    
    try {
      let result;
      
      switch (command) {
        case 'navigate_to_url':
          result = await this.navigateToUrl(params, commandId);
          break;
        case 'get_current_url':
          result = await this.getCurrentUrl(params);
          break;
        case 'cleanup_navigation':
          this.cleanupNavigationListener(params.commandId);
          result = { success: true, message: 'Navigation listener cleaned up' };
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      
      // Send success response
      this.sendToMcpServer({
        type: 'command_response',
        id: commandId,
        data: {
          success: true,
          data: result
        }
      });
      
    } catch (error) {
      console.error(`Command ${command} failed:`, error);
      
      // Send error response
      this.sendToMcpServer({
        type: 'command_response',
        id: commandId,
        data: {
          success: false,
          error: error.message
        }
      });
    }
  }
  
  async navigateToUrl(params, commandId) {
    const { url, tabId, timeout = 15000 } = params;
    
    try {
      // Determine target tab
      const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
      
      // Send initial navigation started event
      this.sendNavigationEvent(commandId, {
        event: 'navigation_started',
        requestedUrl: url,
        tabId: targetTabId,
        timestamp: Date.now()
      });
      
      // Set up event listener for this navigation
      const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== targetTabId) return;
        
        // Send URL change events
        if (changeInfo.url) {
          this.sendNavigationEvent(commandId, {
            event: 'url_changed',
            url: changeInfo.url,
            tabId: targetTabId,
            timestamp: Date.now()
          });
        }
        
        // Send status change events
        if (changeInfo.status) {
          this.sendNavigationEvent(commandId, {
            event: 'status_changed',
            status: changeInfo.status,
            url: tab.url,
            title: tab.title,
            tabId: targetTabId,
            timestamp: Date.now()
          });
        }
        
        // Send title change events
        if (changeInfo.title) {
          this.sendNavigationEvent(commandId, {
            event: 'title_changed',
            title: changeInfo.title,
            url: tab.url,
            tabId: targetTabId,
            timestamp: Date.now()
          });
        }
      };
      
      // Store the listener so we can clean it up later
      this.navigationListeners = this.navigationListeners || new Map();
      this.navigationListeners.set(commandId, listener);
      
      // Start listening for tab updates
      chrome.tabs.onUpdated.addListener(listener);
      
      // Initiate navigation
      await chrome.tabs.update(targetTabId, { url });
      
      // Return immediately - MCP server will handle stability detection
      return {
        success: true,
        message: 'Navigation initiated, streaming events...',
        tabId: targetTabId
      };
      
    } catch (error) {
      this.sendNavigationEvent(commandId, {
        event: 'navigation_error',
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  sendNavigationEvent(commandId, eventData) {
    this.sendToMcpServer({
      type: 'navigation_event',
      commandId: commandId,
      data: eventData
    });
  }
  
  cleanupNavigationListener(commandId) {
    if (this.navigationListeners && this.navigationListeners.has(commandId)) {
      const listener = this.navigationListeners.get(commandId);
      chrome.tabs.onUpdated.removeListener(listener);
      this.navigationListeners.delete(commandId);
    }
  }
  
  async getCurrentUrl(params) {
    const { tabId } = params;
    
    if (tabId) {
      // Get specific tab info
      const tab = await chrome.tabs.get(tabId);
      return {
        tabId: tab.id,
        url: tab.url,
        title: tab.title
      };
    } else {
      // Get current active tab info
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return {
        tabId: activeTab.id,
        url: activeTab.url,
        title: activeTab.title
      };
    }
  }
  
  setupTabListeners() {
    // Listen for tab updates to attach debugger
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
        this.attachDebuggerToTab(tabId);
        // Send tab info to MCP server
        this.sendToMcpServer({
          type: 'tab_info',
          data: {
            tabId: tabId,
            title: tab.title || 'Unknown Tab',
            url: tab.url
          }
        });
      }
    });
    
    // Clean up when tabs are closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.detachDebuggerFromTab(tabId);
    });
  }
  
  async attachDebuggerToTab(tabId) {
    try {
      // Attach debugger to tab
      await chrome.debugger.attach({tabId}, '1.3');
      
      // Enable Runtime domain for console API
      await chrome.debugger.sendCommand({tabId}, 'Runtime.enable');
      
      // Enable Console domain 
      await chrome.debugger.sendCommand({tabId}, 'Console.enable');
      
      this.attachedTabs.add(tabId);
      console.log(`Debugger attached to tab ${tabId}`);
      
      // Listen for console events
      chrome.debugger.onEvent.addListener((source, method, params) => {
        if (source.tabId === tabId) {
          this.handleDebuggerEvent(tabId, method, params);
        }
      });
      
    } catch (error) {
      console.log(`Failed to attach debugger to tab ${tabId}:`, error.message);
    }
  }
  
  async detachDebuggerFromTab(tabId) {
    if (this.attachedTabs.has(tabId)) {
      try {
        await chrome.debugger.detach({tabId});
        this.attachedTabs.delete(tabId);
        console.log(`Debugger detached from tab ${tabId}`);
      } catch (error) {
        console.log(`Failed to detach debugger from tab ${tabId}:`, error.message);
      }
    }
  }
  
  handleDebuggerEvent(tabId, method, params) {
    if (method === 'Runtime.consoleAPICalled') {
      this.addConsoleLog(tabId, {
        level: params.type,
        message: this.formatConsoleArgs(params.args),
        timestamp: params.timestamp,
        url: params.executionContextId ? 'page' : 'unknown',
        lineNumber: params.lineNumber || 0
      });
    } else if (method === 'Runtime.exceptionThrown') {
      this.addConsoleLog(tabId, {
        level: 'error',
        message: params.exceptionDetails.text,
        timestamp: params.timestamp,
        url: 'exception',
        lineNumber: params.exceptionDetails.lineNumber || 0,
        stackTrace: params.exceptionDetails.stackTrace
      });
    }
  }
  
  formatConsoleArgs(args) {
    return args.map(arg => {
      if (arg.type === 'string') return arg.value;
      if (arg.type === 'number') return arg.value.toString();
      if (arg.type === 'boolean') return arg.value.toString();
      if (arg.type === 'object') return JSON.stringify(arg.preview || {type: arg.subtype || 'object'});
      return String(arg.value || arg.description || '[object]');
    }).join(' ');
  }
  
  addConsoleLog(tabId, logEntry) {
    const log = {
      id: crypto.randomUUID(),
      tabId,
      ...logEntry,
      timestamp: Date.now()
    };
    
    this.logs.unshift(log);
    
    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    console.log('Console log captured:', log);
    
    // Send to MCP server via WebSocket
    this.sendToMcpServer({
      type: 'console_log',
      data: log
    });
  }
  
  getConsoleLogs(options = {}) {
    const {tabId, limit = 50, level} = options;
    
    let filteredLogs = this.logs;
    
    if (tabId) {
      filteredLogs = filteredLogs.filter(log => log.tabId === tabId);
    }
    
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }
    
    return filteredLogs.slice(0, limit);
  }
}

// Initialize the console log collector
const consoleCollector = new ConsoleLogCollector();

// Handle messages from MCP server (via content script bridge)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'mcp_get_console_logs') {
    const logs = consoleCollector.getConsoleLogs(message.params);
    sendResponse({success: true, data: logs});
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'mcp_attach_tab') {
    const tabId = message.params.tabId;
    consoleCollector.attachDebuggerToTab(tabId);
    sendResponse({success: true});
    return true;
  }
  
  if (message.type === 'mcp_check_connection') {
    // Check if MCP server is connected via WebSocket
    const connected = consoleCollector.wsConnection && 
                     consoleCollector.wsConnection.readyState === WebSocket.OPEN;
    
    sendResponse({success: true, connected});
    return true;
  }
});

// Extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Enhanced Browser MCP extension started');
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Enhanced Browser MCP extension installed');
});