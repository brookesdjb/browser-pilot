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
        case 'get_dom_snapshot':
          result = await this.getDomSnapshot(params);
          break;
        case 'take_screenshot':
          result = await this.takeScreenshot(params);
          break;
        case 'find_clickable_element':
          result = await this.findClickableElement(params);
          break;
        case 'click_element_by_identifier':
          result = await this.clickElementByIdentifier(params);
          break;
        case 'type_text_in_element':
          result = await this.typeTextInElement(params);
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

  async getDomSnapshot(params) {
    const { tabId, includeStyles = false, selector } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const tab = await chrome.tabs.get(targetTabId);
      
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (selectorParam, includeStylesParam) => {
          const selector = selectorParam;
          const includeStyles = includeStylesParam;
          try {
            let element;
            let elementCount = 1;
            
            if (selector) {
              // Get specific element
              element = document.querySelector(selector);
              if (!element) {
                return {
                  error: `No element found matching selector: ${selector}`,
                  elementCount: 0
                };
              }
            } else {
              // Get full document
              element = document.documentElement;
              elementCount = document.querySelectorAll('*').length;
            }
            
            let html;
            
            if (includeStyles && element === document.documentElement) {
              // For full document with styles, include computed styles
              const elementsWithStyles = [];
              const allElements = element.querySelectorAll('*');
              
              allElements.forEach(el => {
                const computedStyles = window.getComputedStyle(el);
                const styles = {};
                
                // Get key style properties
                const importantProps = [
                  'display', 'position', 'top', 'left', 'width', 'height',
                  'margin', 'padding', 'background-color', 'color', 'font-size',
                  'font-family', 'border', 'z-index', 'opacity', 'visibility'
                ];
                
                importantProps.forEach(prop => {
                  const value = computedStyles.getPropertyValue(prop);
                  if (value && value !== 'initial' && value !== 'auto') {
                    styles[prop] = value;
                  }
                });
                
                if (Object.keys(styles).length > 0) {
                  el.setAttribute('data-computed-styles', JSON.stringify(styles));
                }
              });
              
              html = element.outerHTML;
              
              // Clean up - remove the data attributes we added
              allElements.forEach(el => {
                el.removeAttribute('data-computed-styles');
              });
            } else {
              // Standard HTML without computed styles
              html = element.outerHTML;
            }
            
            return {
              html: html,
              elementCount: selector ? 1 : elementCount,
              selector: selector || null
            };
            
          } catch (error) {
            return {
              error: `DOM snapshot error: ${error.message}`,
              html: '',
              elementCount: 0
            };
          }
        },
        args: [selector || null, includeStyles || false]
      });
      
      const scriptResult = result[0].result;
      
      if (scriptResult.error) {
        throw new Error(scriptResult.error);
      }
      
      return {
        tabId: targetTabId,
        url: tab.url,
        title: tab.title,
        html: scriptResult.html,
        elementCount: scriptResult.elementCount,
        selector: scriptResult.selector,
        includeStyles: includeStyles
      };
      
    } catch (error) {
      throw new Error(`Failed to get DOM snapshot: ${error.message}`);
    }
  }

  async takeScreenshot(params) {
    const { tabId, fullPage = false, quality = 90, format = 'png', selector } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const tab = await chrome.tabs.get(targetTabId);
      let dataUrl;
      let dimensions = null;
      
      if (selector) {
        // Screenshot specific element
        const result = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (selectorParam) => {
            const element = document.querySelector(selectorParam);
            if (!element) {
              return { error: `No element found matching selector: ${selectorParam}` };
            }
            
            const rect = element.getBoundingClientRect();
            return {
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            };
          },
          args: [selector]
        });
        
        const scriptResult = result[0].result;
        if (scriptResult.error) {
          throw new Error(scriptResult.error);
        }
        
        const rect = scriptResult.rect;
        
        // Capture visible tab first
        const fullScreenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: format,
          quality: format === 'jpeg' ? quality : undefined
        });
        
        // Use canvas to crop the element
        const croppedDataUrl = await this.cropImage(fullScreenshot, rect);
        dataUrl = croppedDataUrl;
        dimensions = { width: Math.round(rect.width), height: Math.round(rect.height) };
        
      } else if (fullPage) {
        // Full page screenshot - scroll through page
        dataUrl = await this.captureFullPageScreenshot(targetTabId, format, quality);
        
        // Get page dimensions
        const pageDimensions = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: () => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight
          })
        });
        
        dimensions = pageDimensions[0].result;
        
      } else {
        // Viewport screenshot
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: format,
          quality: format === 'jpeg' ? quality : undefined
        });
        
        // Get viewport dimensions
        const viewportDimensions = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: () => ({
            width: window.innerWidth,
            height: window.innerHeight
          })
        });
        
        dimensions = viewportDimensions[0].result;
      }
      
      return {
        tabId: targetTabId,
        url: tab.url,
        title: tab.title,
        dataUrl: dataUrl,
        dimensions: dimensions,
        format: format,
        fullPage: fullPage,
        selector: selector || null
      };
      
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  async captureFullPageScreenshot(tabId, format, quality) {
    // Get page dimensions and current scroll position
    const pageInfo = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        currentScrollX: window.scrollX,
        currentScrollY: window.scrollY
      })
    });
    
    const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, currentScrollX, currentScrollY } = pageInfo[0].result;
    
    // Calculate how many screenshots we need
    const horizontalSteps = Math.ceil(scrollWidth / viewportWidth);
    const verticalSteps = Math.ceil(scrollHeight / viewportHeight);
    
    // If page fits in viewport, just take one screenshot
    if (horizontalSteps === 1 && verticalSteps === 1) {
      const tab = await chrome.tabs.get(tabId);
      return await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: format,
        quality: format === 'jpeg' ? quality : undefined
      });
    }
    
    // For now, just take viewport screenshot as full page stitching is complex
    // TODO: Implement proper full page stitching
    const tab = await chrome.tabs.get(tabId);
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: format,
      quality: format === 'jpeg' ? quality : undefined
    });
    
    // Restore original scroll position
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (x, y) => {
        window.scrollTo(x, y);
      },
      args: [currentScrollX, currentScrollY]
    });
    
    return screenshot;
  }

  async cropImage(dataUrl, rect) {
    // For now, just return the original image since cropping in service worker is complex
    // TODO: Implement proper image cropping using offscreen canvas when supported
    console.log('Element screenshot requested, but cropping not yet supported. Returning full viewport screenshot.');
    return dataUrl;
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

  async findClickableElement(params) {
    const { tabId, selector, text } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (selectorParam, textParam) => {
          const selector = selectorParam;
          const text = textParam;
          
          // Function to get element coordinates relative to viewport
          const getElementCoords = (element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            };
          };
          
          // Function to check if element is visible and clickable
          const isElementClickable = (element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   element.offsetWidth > 0 && 
                   element.offsetHeight > 0;
          };
          
          // Function to generate CSS selector for element
          const generateSelector = (element) => {
            if (element.id) return `#${element.id}`;
            if (element.className && typeof element.className === 'string') {
              const classes = element.className.split(' ').filter(c => c.trim());
              if (classes.length > 0) return `.${classes.join('.')}`;
            }
            return element.tagName.toLowerCase();
          };
          
          let targetElement = null;
          
          // Search by selector first
          if (selector) {
            try {
              const elements = document.querySelectorAll(selector);
              for (const element of elements) {
                if (isElementClickable(element)) {
                  targetElement = element;
                  break;
                }
              }
            } catch (error) {
              console.log('Invalid selector:', selector);
            }
          }
          
          // Search by text if no element found by selector
          if (!targetElement && text) {
            const clickableSelectors = [
              'button', 'a', '[onclick]', '[role="button"]', 
              'input[type="button"]', 'input[type="submit"]', 
              '.btn', '.button', '.link', '.nav-link',
              'li', 'div[onclick]', 'span[onclick]'
            ];
            
            for (const sel of clickableSelectors) {
              const elements = document.querySelectorAll(sel);
              for (const element of elements) {
                const elementText = element.textContent || element.innerText || '';
                if (elementText.toLowerCase().includes(text.toLowerCase()) && isElementClickable(element)) {
                  targetElement = element;
                  break;
                }
              }
              if (targetElement) break;
            }
          }
          
          if (!targetElement) {
            return { 
              error: `No clickable element found${selector ? ` with selector "${selector}"` : ''}${text ? ` containing text "${text}"` : ''}` 
            };
          }
          
          const coords = getElementCoords(targetElement);
          const elementText = targetElement.textContent || targetElement.innerText || '';
          
          return {
            selector: generateSelector(targetElement),
            text: elementText.trim().substring(0, 100), // Limit text length
            tagName: targetElement.tagName.toLowerCase(),
            coordinates: coords,
            isVisible: true,
            isClickable: true
          };
        },
        args: [selector || null, text || null]
      });
      
      const scriptResult = result[0].result;
      
      if (scriptResult.error) {
        return { success: false, error: scriptResult.error };
      }
      
      return {
        success: true,
        data: scriptResult
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to find clickable element: ${error.message}` 
      };
    }
  }


  async clickElementByIdentifier(params) {
    const { tabId, selector, text } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (selectorParam, textParam) => {
          console.log('=== MCP Extension: Starting element click by identifier ===');
          console.log('Selector:', selectorParam, 'Text:', textParam);
          
          // Subtle background flash to show we're running
          const originalBg = document.body.style.backgroundColor;
          document.body.style.backgroundColor = 'rgba(255, 255, 0, 0.1)';
          
          let targetElement = null;
          let method = '';
          
          // First try selector if provided
          if (selectorParam) {
            try {
              const elements = document.querySelectorAll(selectorParam);
              for (const element of elements) {
                const style = window.getComputedStyle(element);
                if (style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    element.offsetWidth > 0 && 
                    element.offsetHeight > 0) {
                  targetElement = element;
                  method = `selector: ${selectorParam}`;
                  break;
                }
              }
            } catch (error) {
              console.log('Invalid selector:', selectorParam);
            }
          }
          
          // Then try text search if no element found and text provided
          if (!targetElement && textParam) {
            const clickableSelectors = [
              'button', 'a', '[onclick]', '[role="button"]', 
              'input[type="button"]', 'input[type="submit"]', 
              '.btn', '.button', '.link', '.nav-link',
              'li', 'div[onclick]', 'span[onclick]'
            ];
            
            for (const sel of clickableSelectors) {
              const elements = document.querySelectorAll(sel);
              for (const element of elements) {
                const elementText = element.textContent || element.innerText || '';
                const style = window.getComputedStyle(element);
                if (elementText.toLowerCase().includes(textParam.toLowerCase()) &&
                    style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    element.offsetWidth > 0 && 
                    element.offsetHeight > 0) {
                  targetElement = element;
                  method = `text: "${textParam}" in ${sel}`;
                  break;
                }
              }
              if (targetElement) break;
            }
          }
          
          if (targetElement) {
            console.log('MCP Extension: Found target element:', targetElement);
            console.log('MCP Extension: Method:', method);
            console.log('MCP Extension: About to click element...');
            
            targetElement.click();
            
            console.log('MCP Extension: Clicked element - SUCCESS!');
            
            // Subtle green flash to show success
            setTimeout(() => {
              document.body.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
              setTimeout(() => {
                document.body.style.backgroundColor = originalBg;
              }, 300);
            }, 200);
            
            return {
              success: true,
              message: `Element found and clicked successfully via ${method}`,
              elementText: (targetElement.textContent || targetElement.innerText || '').trim().substring(0, 100),
              elementTag: targetElement.tagName.toLowerCase(),
              selector: method.startsWith('selector:') ? selectorParam : null
            };
          } else {
            console.log('MCP Extension: Target element NOT found');
            
            // Subtle red flash to show failure
            document.body.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            setTimeout(() => {
              document.body.style.backgroundColor = originalBg;
            }, 300);
            
            return {
              success: false,
              message: `No clickable element found${selectorParam ? ` with selector "${selectorParam}"` : ''}${textParam ? ` containing text "${textParam}"` : ''}`
            };
          }
        },
        args: [selector || null, text || null]
      });
      
      const scriptResult = result[0].result;
      console.log('Element click result:', scriptResult);
      return scriptResult;
      
    } catch (error) {
      console.error('Failed to execute element click:', error);
      return { 
        success: false, 
        error: `Failed to execute element click: ${error.message}` 
      };
    }
  }

  async typeTextInElement(params) {
    const { tabId, selector, text, textToType, clearFirst = true, submit = false } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (selectorParam, textParam, textToTypeParam, clearFirstParam, submitParam) => {
          console.log('=== MCP Extension: Starting text input ===');
          console.log('Selector:', selectorParam, 'Text:', textParam, 'TextToType:', textToTypeParam);
          
          // Subtle background flash to show we're running
          const originalBg = document.body.style.backgroundColor;
          document.body.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
          
          let targetElement = null;
          let method = '';
          
          // First try selector if provided
          if (selectorParam) {
            try {
              const elements = document.querySelectorAll(selectorParam);
              for (const element of elements) {
                const style = window.getComputedStyle(element);
                if (style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    element.offsetWidth > 0 && 
                    element.offsetHeight > 0) {
                  targetElement = element;
                  method = `selector: ${selectorParam}`;
                  break;
                }
              }
            } catch (error) {
              console.log('Invalid selector:', selectorParam);
            }
          }
          
          // Then try text search if no element found and text provided
          if (!targetElement && textParam) {
            const inputSelectors = [
              'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
              'input[type="search"]', 'input[type="url"]', 'input[type="tel"]',
              'input:not([type])', 'textarea', '[contenteditable="true"]',
              '.input', '.form-control', '[role="textbox"]'
            ];
            
            for (const sel of inputSelectors) {
              const elements = document.querySelectorAll(sel);
              for (const element of elements) {
                const elementText = element.placeholder || element.getAttribute('aria-label') || element.textContent || '';
                const style = window.getComputedStyle(element);
                if (elementText.toLowerCase().includes(textParam.toLowerCase()) &&
                    style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    element.offsetWidth > 0 && 
                    element.offsetHeight > 0) {
                  targetElement = element;
                  method = `text: "${textParam}" in ${sel}`;
                  break;
                }
              }
              if (targetElement) break;
            }
          }
          
          if (targetElement) {
            console.log('MCP Extension: Found target input element:', targetElement);
            console.log('MCP Extension: Method:', method);
            console.log('MCP Extension: About to type text...');
            
            // Focus the element first
            targetElement.focus();
            
            // Clear existing text if requested
            if (clearFirstParam) {
              targetElement.value = '';
            }
            
            // Set the text value
            targetElement.value = textToTypeParam;
            
            // Trigger input events to notify frameworks like React/Angular
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            targetElement.dispatchEvent(inputEvent);
            targetElement.dispatchEvent(changeEvent);
            
            // Submit if requested (press Enter)
            if (submitParam) {
              const keydownEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
              });
              const keyupEvent = new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
              });
              targetElement.dispatchEvent(keydownEvent);
              targetElement.dispatchEvent(keyupEvent);
            }
            
            console.log('MCP Extension: Text input completed - SUCCESS!');
            
            // Subtle green flash to show success
            setTimeout(() => {
              document.body.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
              setTimeout(() => {
                document.body.style.backgroundColor = originalBg;
              }, 300);
            }, 200);
            
            return {
              success: true,
              message: `Text "${textToTypeParam}" entered successfully via ${method}`,
              elementType: targetElement.tagName.toLowerCase(),
              elementPlaceholder: targetElement.placeholder || '',
              selector: method.startsWith('selector:') ? selectorParam : null,
              submitted: submitParam
            };
          } else {
            console.log('MCP Extension: Target input element NOT found');
            
            // Subtle red flash to show failure
            document.body.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            setTimeout(() => {
              document.body.style.backgroundColor = originalBg;
            }, 300);
            
            return {
              success: false,
              message: `No input element found${selectorParam ? ` with selector "${selectorParam}"` : ''}${textParam ? ` containing text "${textParam}"` : ''}`
            };
          }
        },
        args: [selector || null, text || null, textToType, clearFirst, submit]
      });
      
      const scriptResult = result[0].result;
      console.log('Text input result:', scriptResult);
      return scriptResult;
      
    } catch (error) {
      console.error('Failed to execute text input:', error);
      return { 
        success: false, 
        error: `Failed to execute text input: ${error.message}` 
      };
    }
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