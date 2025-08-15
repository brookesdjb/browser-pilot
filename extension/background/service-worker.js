// Enhanced Browser MCP - Background Service Worker
// Handles console log collection via Chrome debugger API

class ConsoleLogCollector {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.attachedTabs = new Set();
    this.pendingNetworkRequests = new Map(); // requestId -> request data
    this.mcpServerVersion = null; // Store server version from connection
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
            // Store server version if provided
            if (message.serverVersion) {
              this.mcpServerVersion = message.serverVersion;
              console.log('MCP server version:', this.mcpServerVersion);
            }
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
        case 'get_local_storage':
          result = await this.getLocalStorage(params);
          break;
        case 'get_session_storage':
          result = await this.getSessionStorage(params);
          break;
        case 'get_cookies':
          result = await this.getCookies(params);
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

  async getLocalStorage(params) {
    const { tabId } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => {
          const items = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            items[key] = localStorage.getItem(key);
          }
          return items;
        }
      });
      
      return {
        tabId: targetTabId,
        items: result[0].result
      };
    } catch (error) {
      throw new Error(`Failed to get local storage: ${error.message}`);
    }
  }

  async getSessionStorage(params) {
    const { tabId } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: () => {
          const items = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            items[key] = sessionStorage.getItem(key);
          }
          return items;
        }
      });
      
      return {
        tabId: targetTabId,
        items: result[0].result
      };
    } catch (error) {
      throw new Error(`Failed to get session storage: ${error.message}`);
    }
  }

  async getCookies(params) {
    const { tabId } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const tab = await chrome.tabs.get(targetTabId);
      const url = new URL(tab.url);
      
      const cookies = await chrome.cookies.getAll({
        domain: url.hostname
      });
      
      return {
        tabId: targetTabId,
        url: tab.url,
        cookies: cookies
      };
    } catch (error) {
      throw new Error(`Failed to get cookies: ${error.message}`);
    }
  }

  async getMcpServerVersion() {
    // Return the version we got from connection confirmation
    return Promise.resolve(this.mcpServerVersion || 'Unknown');
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
      
      // Enable Network domain for request monitoring
      await chrome.debugger.sendCommand({tabId}, 'Network.enable');
      
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

  handleNetworkEvent(tabId, method, params) {
    try {
      const requestId = params.requestId;
      
      switch (method) {
        case 'Network.requestWillBeSent':
          // Start tracking new request
          const request = params.request;
          
          // Only track XHR and Fetch requests
          if (params.type !== 'XHR' && params.type !== 'Fetch') {
            return;
          }
          
          const networkRequest = {
            id: requestId,
            tabId: tabId,
            method: request.method,
            url: request.url,
            requestHeaders: request.headers || {},
            requestBody: request.postData || undefined,
            timing: {
              startTime: params.timestamp * 1000, // Convert to milliseconds
            },
            timestamp: Date.now(),
            type: params.type.toLowerCase()
          };
          
          this.pendingNetworkRequests.set(requestId, networkRequest);
          
          // Send initial request data to MCP server
          this.sendToMcpServer({
            type: 'network_request',
            data: networkRequest
          });
          break;
          
        case 'Network.responseReceived':
          // Update request with response info
          const pendingRequest = this.pendingNetworkRequests.get(requestId);
          if (pendingRequest) {
            const response = params.response;
            const updatedRequest = {
              ...pendingRequest,
              status: response.status,
              statusText: response.statusText,
              responseHeaders: response.headers || {},
              responseSize: response.encodedDataLength || 0
            };
            
            this.pendingNetworkRequests.set(requestId, updatedRequest);
            
            // Send updated request data to MCP server
            this.sendToMcpServer({
              type: 'network_request',
              data: updatedRequest
            });
          }
          break;
          
        case 'Network.loadingFinished':
          // Finalize request timing
          const finishingRequest = this.pendingNetworkRequests.get(requestId);
          if (finishingRequest) {
            const finalRequest = {
              ...finishingRequest,
              timing: {
                ...finishingRequest.timing,
                duration: (params.timestamp * 1000) - finishingRequest.timing.startTime
              }
            };
            
            // Send final request data to MCP server
            this.sendToMcpServer({
              type: 'network_request',
              data: finalRequest
            });
            
            // Clean up - remove from pending requests
            this.pendingNetworkRequests.delete(requestId);
          }
          break;
          
        case 'Network.loadingFailed':
          // Handle failed requests
          const failedRequest = this.pendingNetworkRequests.get(requestId);
          if (failedRequest) {
            const errorRequest = {
              ...failedRequest,
              status: 0,
              statusText: params.errorText || 'Network Error',
              timing: {
                ...failedRequest.timing,
                duration: (params.timestamp * 1000) - failedRequest.timing.startTime
              }
            };
            
            // Send failed request data to MCP server
            this.sendToMcpServer({
              type: 'network_request',
              data: errorRequest
            });
            
            // Clean up - remove from pending requests
            this.pendingNetworkRequests.delete(requestId);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling network event:', error);
    }
  }
  
  handleDebuggerEvent(tabId, method, params) {
    // Handle network events
    if (method.startsWith('Network.')) {
      this.handleNetworkEvent(tabId, method, params);
      return;
    }
    
    // Handle console events
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
  
  if (message.type === 'mcp_get_version') {
    // Get MCP server version by sending command
    if (consoleCollector.wsConnection && consoleCollector.wsConnection.readyState === WebSocket.OPEN) {
      consoleCollector.getMcpServerVersion()
        .then(version => {
          sendResponse({success: true, version});
        })
        .catch(error => {
          console.error('Failed to get MCP server version:', error);
          sendResponse({success: false, error: error.message});
        });
      return true; // Keep message channel open for async response
    } else {
      sendResponse({success: false, error: 'MCP server not connected'});
      return true;
    }
  }
});

// Extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Enhanced Browser MCP extension started');
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Enhanced Browser MCP extension installed');
});