// Enhanced Browser MCP - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const tabTitleEl = document.getElementById('tab-title');
  const tabUrlEl = document.getElementById('tab-url');
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  const logsCountEl = document.getElementById('logs-count');
  
  try {
    // Get current tab info
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Update tab info display
    tabTitleEl.textContent = tab.title || 'Untitled Tab';
    tabUrlEl.textContent = tab.url || 'No URL';
    
    // Test extension functionality
    const response = await chrome.runtime.sendMessage({
      type: 'mcp_get_console_logs',
      params: { tabId: tab.id, limit: 1 }
    });
    
    if (response.success) {
      // Get total logs count for this tab
      const allLogs = await chrome.runtime.sendMessage({
        type: 'mcp_get_console_logs',
        params: { tabId: tab.id, limit: 1000 }
      });
      
      logsCountEl.textContent = allLogs.data.length;
      
      // Check MCP server connection (by checking if log file exists)
      await checkMcpConnection();
      
    } else {
      throw new Error('Failed to get logs from extension');
    }
    
  } catch (error) {
    tabTitleEl.textContent = 'Error getting tab info';
    tabUrlEl.textContent = 'Extension connection failed';
    mcpConnectionEl.textContent = 'Unknown';
    console.error('Popup error:', error);
  }
});

async function checkMcpConnection() {
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  
  try {
    // Check if MCP server is connected by looking for the communication file
    // This is a simple check - in production you'd have a more robust method
    const response = await chrome.runtime.sendMessage({
      type: 'mcp_check_connection'
    });
    
    if (response && response.connected) {
      mcpConnectionEl.textContent = 'Connected';
      mcpStatusEl.className = 'status connected';
    } else {
      mcpConnectionEl.textContent = 'Not Connected';
      mcpStatusEl.className = 'status disconnected';
    }
  } catch (error) {
    mcpConnectionEl.textContent = 'Unknown';
    mcpStatusEl.className = 'status disconnected';
  }
}