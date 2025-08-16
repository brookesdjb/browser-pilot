// Browser Pilot - Background Service Worker with Native Messaging
// Handles console log collection via Chrome debugger API and communicates via Native Messaging

class ConsoleLogCollector {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.attachedTabs = new Set();
    this.pendingNetworkRequests = new Map(); // requestId -> request data
    
    // Native messaging connection
    this.nativePort = null;
    this.isConnected = false;
    this.pendingCommands = new Map(); // commandId -> { resolve, reject, timeout }
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000; // Start with 2 seconds
    this.navigationListeners = new Map();

    // Connect to native messaging host
    this.connectToNativeHost();
    this.setupTabListeners();
    
    // Set up ping interval to keep the connection alive
    this.pingInterval = setInterval(() => {
      this.pingNativeHost();
    }, 30000); // 30 seconds
  }
  
  async connectToNativeHost() {
    try {
      console.log('Connecting to Browser Pilot native host...');
      
      // Connect to the native messaging host
      this.nativePort = chrome.runtime.connectNative('com.brookesdjb.browser_pilot');
      
      // Handle messages from the native host
      this.nativePort.onMessage.addListener((message) => {
        this.handleNativeHostMessage(message);
      });
      
      // Handle disconnection
      this.nativePort.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Disconnected from Browser Pilot native host:', error ? error.message : 'No error');
        this.isConnected = false;
        this.nativePort = null;
        
        // Clear all pending commands with error
        this.pendingCommands.forEach((command, id) => {
          clearTimeout(command.timeout);
          command.reject(new Error('Native host connection lost'));
        });
        this.pendingCommands.clear();
        
        // Try to reconnect if not at max attempts
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
          console.log(`Reconnecting to native host in ${delay}ms (attempt ${this.reconnectAttempts})`);
          
          setTimeout(() => {
            this.connectToNativeHost();
          }, delay);
        }
      });
      
      // Mark as connected and reset reconnect attempts
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Send initial info message
      this.sendToNativeHost({
        type: 'extension_info',
        data: {
          version: chrome.runtime.getManifest().version,
          userAgent: navigator.userAgent,
          timestamp: Date.now(),
          attachedTabs: Array.from(this.attachedTabs)
        }
      });
      
      console.log(`Native host connected. Currently attached to ${this.attachedTabs.size} tabs.`);
      
    } catch (error) {
      console.error('Failed to connect to native host:', error);
      this.isConnected = false;
      this.nativePort = null;
      
      // Try to reconnect if not at max attempts
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
        console.log(`Reconnecting to native host in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
          this.connectToNativeHost();
        }, delay);
      }
    }
  }
  
  async pingNativeHost() {
    // Skip if not connected
    if (!this.nativePort) {
      return;
    }
    
    try {
      // Send a ping message and expect a pong response
      const response = await this.sendCommandToNativeHost('ping', {
        timestamp: Date.now()
      }, 5000); // 5 second timeout
      
      if (response && response.type === 'pong') {
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset reconnect attempts on successful ping
        console.log('Ping successful, native host is connected');
        
        // Log the number of connected MCP clients
        if (response.data && response.data.mpcClientCount !== undefined) {
          console.log(`Native host connected to ${response.data.mpcClientCount} MCP clients`);
        }
      }
    } catch (error) {
      console.log('Ping failed:', error);
      this.isConnected = false;
      
      // Trigger reconnection on ping failure (connection likely lost)
      console.log('Ping failure detected, triggering reconnection...');
      
      // Disconnect the current port if it exists
      if (this.nativePort) {
        try {
          this.nativePort.disconnect();
        } catch (disconnectError) {
          console.log('Error disconnecting failed port:', disconnectError);
        }
        this.nativePort = null;
      }
      
      // Clear all pending commands
      this.pendingCommands.forEach((command, id) => {
        clearTimeout(command.timeout);
        command.reject(new Error('Connection lost during ping failure'));
      });
      this.pendingCommands.clear();
      
      // Start reconnection process
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
        console.log(`Reconnecting after ping failure in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
          this.connectToNativeHost();
        }, delay);
      } else {
        console.log('Max reconnect attempts reached after ping failure');
      }
    }
  }
  
  handleNativeHostMessage(message) {
    try {
      if (!message || !message.type) {
        console.error('Invalid message from native host:', message);
        return;
      }
      
      // If we're receiving messages, the connection must be active
      // This ensures the connection status is accurate even if pings fail
      this.isConnected = true;
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful message
      
      console.log('Received message from native host:', message.type);
      
      // Handle message based on type
      switch (message.type) {
        case 'pong':
          // Handle ping response
          const pendingPing = this.pendingCommands.get(message.id);
          if (pendingPing) {
            clearTimeout(pendingPing.timeout);
            this.pendingCommands.delete(message.id);
            pendingPing.resolve(message);
          }
          break;
          
        case 'command':
          // Handle command from MCP server (via native host)
          this.handleCommand(message);
          break;
          
        case 'extension_disconnected':
          // Native host reported that extension is disconnected
          console.log('Native host reported extension disconnection');
          break;
          
        case 'host_shutting_down':
          // Native host is shutting down
          console.log('Native host is shutting down');
          this.isConnected = false;
          // Will reconnect automatically due to onDisconnect handler
          break;
          
        case 'mcp_client_connected':
          // MCP client connected to native host
          console.log('MCP client connected:', message.data.clientId);
          break;
          
        case 'mcp_client_disconnected':
          // MCP client disconnected from native host
          console.log('MCP client disconnected:', message.data.clientId);
          break;
          
        case 'command_response':
          // Handle response from a command
          if (message.id && this.pendingCommands.has(message.id)) {
            const command = this.pendingCommands.get(message.id);
            clearTimeout(command.timeout);
            this.pendingCommands.delete(message.id);
            command.resolve(message.data);
          }
          break;
          
        case 'pong':
          // Response to ping - handle in ping command resolution
          if (message.id && this.pendingCommands.has(message.id)) {
            const command = this.pendingCommands.get(message.id);
            clearTimeout(command.timeout);
            this.pendingCommands.delete(message.id);
            command.resolve(message.data);
          }
          break;
          
        default:
          console.log('Unhandled message type from native host:', message.type);
      }
    } catch (error) {
      console.error('Error handling message from native host:', error);
    }
  }
  
  sendToNativeHost(message) {
    if (this.nativePort) {
      try {
        this.nativePort.postMessage(message);
        return true;
      } catch (error) {
        console.error('Failed to send message to native host:', error);
        return false;
      }
    }
    return false;
  }
  
  sendCommandToNativeHost(command, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // Skip if not connected
      if (!this.nativePort) {
        reject(new Error('Not connected to native host'));
        return;
      }
      
      // Generate unique command ID
      const commandId = crypto.randomUUID();
      
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
      
      // Send command to native host
      if (!this.sendToNativeHost(message)) {
        clearTimeout(timeoutHandle);
        this.pendingCommands.delete(commandId);
        reject(new Error('Failed to send command to native host'));
      }
    });
  }
  
  async handleCommand(message) {
    const { command, params } = message.data;
    const commandId = message.id;
    const sourceClientId = message.source;
    
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
        case 'click_element':
        case 'click_element_by_identifier':
          result = await this.clickElementByIdentifier(params);
          break;
        case 'type_text':
        case 'type_text_in_element':
          result = await this.typeTextInElement(params);
          break;
        case 'cleanup_navigation':
          this.cleanupNavigationListener(params.commandId);
          result = { success: true, message: 'Navigation listener cleaned up' };
          break;
        case 'get_console_logs':
          result = await this.getConsoleLogs(params);
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      
      // Send success response
      this.sendToNativeHost({
        type: 'command_response',
        id: commandId,
        target: sourceClientId, // Send response back to the specific client
        data: {
          success: true,
          data: result
        }
      });
      
    } catch (error) {
      console.error(`Command ${command} failed:`, error);
      
      // Send error response
      this.sendToNativeHost({
        type: 'command_response',
        id: commandId,
        target: sourceClientId, // Send response back to the specific client
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
      
      // Return immediately - native host will handle stability detection
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
    this.sendToNativeHost({
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
      if (!activeTab) {
        throw new Error('No active tab found');
      }
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
        // Send tab info to native host
        this.sendToNativeHost({
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
      // First check if we're already attached to this tab
      if (this.attachedTabs.has(tabId)) {
        console.log(`Debugger already attached to tab ${tabId}`);
        return;
      }
      
      // Check if another debugger is already attached by trying to get targets
      try {
        const targets = await chrome.debugger.getTargets();
        const attachedTarget = targets.find(target => 
          target.tabId === tabId && target.attached
        );
        
        if (attachedTarget) {
          console.log(`Another debugger is already attached to tab ${tabId}, detaching first...`);
          try {
            await chrome.debugger.detach({tabId});
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (detachError) {
            console.log(`Failed to detach existing debugger from tab ${tabId}:`, detachError.message);
          }
        }
      } catch (targetsError) {
        console.log(`Could not check debugger targets:`, targetsError.message);
      }
      
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
      if (error.message.includes('already attached')) {
        console.log(`Debugger already attached to tab ${tabId} (error caught)`);
        // Try to mark as attached anyway, in case the state is out of sync
        this.attachedTabs.add(tabId);
      } else {
        console.log(`Failed to attach debugger to tab ${tabId}:`, error.message);
      }
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
          
          // Send initial request data to native host
          this.sendToNativeHost({
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
            
            // Send updated request data to native host
            this.sendToNativeHost({
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
            
            // Send final request data to native host
            this.sendToNativeHost({
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
            
            // Send failed request data to native host
            this.sendToNativeHost({
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
    
    // Send to native host
    this.sendToNativeHost({
      type: 'console_log',
      data: log
    });
  }

  async clickElementByIdentifier(params) {
    const { tabId, selector, text } = params;
    const targetTabId = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
    
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: (selectorParam, textParam) => {
          console.log('=== Browser Pilot Extension: Starting element click by identifier ===');
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
            console.log('Browser Pilot Extension: Found target element:', targetElement);
            console.log('Browser Pilot Extension: Method:', method);
            console.log('Browser Pilot Extension: About to click element...');
            
            targetElement.click();
            
            console.log('Browser Pilot Extension: Clicked element - SUCCESS!');
            
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
            console.log('Browser Pilot Extension: Target element NOT found');
            
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
          console.log('=== Browser Pilot Extension: Starting text input ===');
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
            console.log('Browser Pilot Extension: Found target input element:', targetElement);
            console.log('Browser Pilot Extension: Method:', method);
            console.log('Browser Pilot Extension: About to type text...');
            
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
            
            console.log('Browser Pilot Extension: Text input completed - SUCCESS!');
            
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
            console.log('Browser Pilot Extension: Target input element NOT found');
            
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

  getLogsForTab(tabId, limit = 100) {
    // Filter logs for the specific tab and return the most recent ones
    const tabLogs = this.logs.filter(log => log.tabId === tabId);
    return tabLogs.slice(0, limit);
  }

  async getConsoleLogs(params) {
    const { tabId, limit = 50, level, since } = params;
    
    let logs = this.logs;
    
    // Filter by tab ID if specified
    if (tabId) {
      logs = logs.filter(log => log.tabId === tabId);
    }
    
    // Filter by level if specified
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    // Filter by timestamp if specified
    if (since) {
      logs = logs.filter(log => log.timestamp >= since);
    }
    
    // Limit results
    logs = logs.slice(0, limit);
    
    return {
      success: true,
      data: logs,
      count: logs.length,
      totalLogs: this.logs.length
    };
  }

  getConnectionStatus() {
    // More reliable connection status - if the port exists at all, we're likely connected
    const portExists = !!this.nativePort;
    
    // Update isConnected based on port existence as a fallback
    if (portExists && !this.isConnected) {
      console.log('Connection status mismatch - port exists but isConnected=false, fixing...');
      this.isConnected = true;
    }
    
    return {
      isConnected: this.isConnected || portExists,  // Use either signal
      reconnectAttempts: this.reconnectAttempts,
      reconnecting: this.reconnectAttempts > 0 && this.reconnectAttempts < this.maxReconnectAttempts
    };
  }

  getDebuggerStatus() {
    return {
      success: true,
      attachedTabs: this.attachedTabs.size,
      attachedTabIds: Array.from(this.attachedTabs)
    };
  }

  async detachAllDebuggers() {
    console.log('Detaching all debuggers...');
    const attachedTabIds = Array.from(this.attachedTabs);
    
    for (const tabId of attachedTabIds) {
      try {
        await this.detachDebuggerFromTab(tabId);
        console.log(`Successfully detached debugger from tab ${tabId}`);
      } catch (error) {
        console.log(`Failed to detach debugger from tab ${tabId}:`, error.message);
      }
    }
    
    this.attachedTabs.clear();
    console.log('All debuggers detached');
    
    return {
      success: true,
      detachedTabs: attachedTabIds.length
    };
  }

  async forceReconnect() {
    console.log('Force reconnecting to native host...');
    
    // Stop the ping interval temporarily to avoid interference
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    // First, detach all debuggers to clean up state
    await this.detachAllDebuggers();
    
    // Disconnect from native host if connected
    if (this.nativePort) {
      try {
        this.nativePort.disconnect();
      } catch (error) {
        console.log('Error disconnecting native port:', error.message);
      }
      this.nativePort = null;
    }
    
    this.isConnected = false;
    this.reconnectAttempts = 0;
    
    // Clear all pending commands
    this.pendingCommands.forEach((command, id) => {
      clearTimeout(command.timeout);
      command.reject(new Error('Force reconnect initiated'));
    });
    this.pendingCommands.clear();
    
    // Try to reconnect immediately
    try {
      await this.connectToNativeHost();
      
      // Restart ping interval
      this.pingInterval = setInterval(() => {
        this.pingNativeHost();
      }, 30000);
      
      return {
        success: true,
        message: 'Reconnection initiated'
      };
    } catch (error) {
      // Restart ping interval even on failure
      this.pingInterval = setInterval(() => {
        this.pingNativeHost();
      }, 30000);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Initialize the console log collector
const consoleCollector = new ConsoleLogCollector();

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Service Worker: Received message:', message.type);
  
  if (message.type === 'mcp_check_connection') {
    // Check if native host is connected
    const status = consoleCollector.getConnectionStatus();
    console.log('Service Worker: Sending connection status:', status);
    sendResponse(status);
    return true;
  }
  
  if (message.type === 'get_debugger_status') {
    // Get debugger attachment status
    const status = consoleCollector.getDebuggerStatus();
    console.log('Service Worker: Sending debugger status:', status);
    sendResponse(status);
    return true;
  }
  
  if (message.type === 'force_reconnect') {
    // Force reconnect to native host with cleanup
    consoleCollector.forceReconnect()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true; // Async response
  }
  
  if (message.type === 'reset_debugger') {
    // Detach all debuggers and reset state
    consoleCollector.detachAllDebuggers()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true; // Async response
  }
  
  if (message.type === 'mcp_get_console_logs') {
    // Get console logs for the specified tab
    const tabId = message.params?.tabId;
    const limit = message.params?.limit || 100;
    
    if (tabId) {
      const logs = consoleCollector.getLogsForTab(tabId, limit);
      sendResponse({
        success: true,
        data: logs
      });
    } else {
      sendResponse({
        success: false,
        error: 'Tab ID is required'
      });
    }
    return true;
  }
});

// Extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser Pilot extension started');
  // Extension restarted, force a fresh connection check
  if (consoleCollector) {
    setTimeout(() => {
      consoleCollector.pingNativeHost();
    }, 1000);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Browser Pilot extension installed or updated');
});

// Handle service worker suspension/resumption
chrome.runtime.onSuspend.addListener(() => {
  console.log('Browser Pilot service worker suspending...');
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('Browser Pilot service worker suspension canceled');
  // Check connection after suspension cancellation
  if (consoleCollector) {
    setTimeout(() => {
      consoleCollector.pingNativeHost();
    }, 500);
  }
});

// Add visibility change handling for when Chrome comes back from background
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && consoleCollector) {
      console.log('Chrome became visible, checking connection...');
      setTimeout(() => {
        consoleCollector.pingNativeHost();
      }, 500);
    }
  });
}