// Enhanced Browser MCP - Content Script
// Bridge between webpage and background script

console.log('Enhanced Browser MCP content script loaded');

// Create MCP Bridge without inline scripts to avoid CSP issues
window.mcpBridge = {
  async getConsoleLogs(params = {}) {
    return new Promise((resolve) => {
      window.postMessage({
        type: 'mcp_get_console_logs',
        params,
        id: Math.random().toString(36).substring(2)
      }, '*');
      
      const handler = (event) => {
        if (event.data.type === 'mcp_console_logs_response') {
          window.removeEventListener('message', handler);
          resolve(event.data.data);
        }
      };
      window.addEventListener('message', handler);
    });
  }
};

console.log('MCP Bridge created in content script');

// Listen for messages from the injected script
window.addEventListener('message', async (event) => {
  if (event.data.type === 'mcp_get_console_logs') {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'mcp_get_console_logs',
        params: event.data.params
      });
      
      window.postMessage({
        type: 'mcp_console_logs_response',
        data: response.data,
        id: event.data.id
      }, '*');
    } catch (error) {
      console.error('Failed to get console logs:', error);
      window.postMessage({
        type: 'mcp_console_logs_response',
        data: [],
        error: error.message,
        id: event.data.id
      }, '*');
    }
  }
});

// Auto-attach debugger to current tab
chrome.runtime.sendMessage({
  type: 'mcp_attach_tab',
  params: { tabId: 'current' }
});