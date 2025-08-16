// Browser Pilot - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const tabTitleEl = document.getElementById('tab-title');
  const tabUrlEl = document.getElementById('tab-url');
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  const mcpVersionEl = document.getElementById('mcp-version');
  const versionTextEl = document.getElementById('version-text');
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
      
      // Check Native Host connection status
      await checkNativeHostConnection();
      
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

async function checkNativeHostConnection() {
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  const mcpVersionEl = document.getElementById('mcp-version');
  const versionTextEl = document.getElementById('version-text');
  
  try {
    // Check if Native Host is connected through the service worker
    const response = await chrome.runtime.sendMessage({
      type: 'mcp_check_connection'
    });
    
    if (response && response.isConnected) {
      mcpConnectionEl.textContent = 'Connected';
      mcpStatusEl.className = 'status connected';
      mcpVersionEl.style.display = 'block';
      versionTextEl.textContent = 'Native Host Connected';
    } else if (response && response.reconnecting) {
      mcpConnectionEl.textContent = `Reconnecting (Attempt ${response.reconnectAttempts})`;
      mcpStatusEl.className = 'status disconnected';
      mcpVersionEl.style.display = 'none';
    } else {
      mcpConnectionEl.textContent = 'Not Connected';
      mcpStatusEl.className = 'status disconnected';
      mcpVersionEl.style.display = 'none';
    }
  } catch (error) {
    mcpConnectionEl.textContent = 'Unknown';
    mcpStatusEl.className = 'status disconnected';
    mcpVersionEl.style.display = 'none';
    console.error('Error checking Native Host connection:', error);
  }
}