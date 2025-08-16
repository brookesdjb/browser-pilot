// Browser Pilot - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const tabTitleEl = document.getElementById('tab-title');
  const tabUrlEl = document.getElementById('tab-url');
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  const mcpVersionEl = document.getElementById('mcp-version');
  const versionTextEl = document.getElementById('version-text');
  const logsCountEl = document.getElementById('logs-count');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const resetDebuggerBtn = document.getElementById('reset-debugger-btn');
  
  try {
    // Get current tab info
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Update tab info display
    tabTitleEl.textContent = tab.title || 'Untitled Tab';
    tabUrlEl.textContent = tab.url || 'No URL';
    
    // Wait a moment for service worker to initialize if needed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check connection statuses first
    await checkNativeHostConnection();
    await checkDebuggerStatus();
    
    // Then try to get console logs
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'mcp_get_console_logs',
        params: { tabId: tab.id, limit: 1000 }
      });
      
      if (response && response.success && response.data) {
        logsCountEl.textContent = response.data.length;
      } else {
        logsCountEl.textContent = '0';
      }
    } catch (logsError) {
      console.log('Could not get console logs:', logsError);
      logsCountEl.textContent = '0';
    }
    
  } catch (error) {
    tabTitleEl.textContent = 'Error getting tab info';
    tabUrlEl.textContent = 'Extension connection failed';
    mcpConnectionEl.textContent = 'Unknown';
    console.error('Popup error:', error);
  }
  
  // Set up button handlers
  reconnectBtn.addEventListener('click', handleReconnect);
  resetDebuggerBtn.addEventListener('click', handleResetDebugger);
  
  // Set up periodic status refresh
  const refreshInterval = setInterval(async () => {
    console.log('Popup: Refreshing status...');
    await checkNativeHostConnection();
    await checkDebuggerStatus();
  }, 5000); // Refresh every 5 seconds
  
  // Clean up interval when popup closes
  window.addEventListener('beforeunload', () => {
    clearInterval(refreshInterval);
  });
});

async function checkNativeHostConnection() {
  const mcpStatusEl = document.getElementById('mcp-status');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  const mcpVersionEl = document.getElementById('mcp-version');
  const versionTextEl = document.getElementById('version-text');
  
  try {
    // Check if Native Host is connected through the service worker
    console.log('Popup: Checking native host connection...');
    
    const response = await chrome.runtime.sendMessage({
      type: 'mcp_check_connection'
    });
    
    console.log('Popup: Received connection response:', response);
    
    if (response && response.isConnected) {
      mcpConnectionEl.textContent = 'Connected';
      mcpStatusEl.className = 'status connected';
      mcpVersionEl.style.display = 'block';
      versionTextEl.textContent = 'Native Host Connected';
    } else if (response && response.reconnecting) {
      mcpConnectionEl.textContent = `Reconnecting (Attempt ${response.reconnectAttempts})`;
      mcpStatusEl.className = 'status disconnected';
      mcpVersionEl.style.display = 'none';
    } else if (response) {
      mcpConnectionEl.textContent = 'Not Connected';
      mcpStatusEl.className = 'status disconnected';
      mcpVersionEl.style.display = 'none';
      console.log('Popup: Native host not connected, response:', response);
    } else {
      mcpConnectionEl.textContent = 'No Response';
      mcpStatusEl.className = 'status disconnected';
      mcpVersionEl.style.display = 'none';
      console.log('Popup: No response from service worker');
    }
  } catch (error) {
    mcpConnectionEl.textContent = 'Error';
    mcpStatusEl.className = 'status disconnected';
    mcpVersionEl.style.display = 'none';
    console.error('Error checking Native Host connection:', error);
  }
}

async function checkDebuggerStatus() {
  const debuggerStatusEl = document.getElementById('debugger-status');
  const debuggerConnectionEl = document.getElementById('debugger-connection');
  const attachedTabsEl = document.getElementById('attached-tabs');
  
  try {
    console.log('Popup: Checking debugger status...');
    
    const response = await chrome.runtime.sendMessage({
      type: 'get_debugger_status'
    });
    
    console.log('Popup: Received debugger response:', response);
    
    if (response && response.success) {
      const attachedCount = response.attachedTabs || 0;
      attachedTabsEl.textContent = attachedCount;
      
      if (attachedCount > 0) {
        debuggerConnectionEl.textContent = 'Attached';
        debuggerStatusEl.className = 'status connected';
      } else {
        debuggerConnectionEl.textContent = 'Not Attached';
        debuggerStatusEl.className = 'status disconnected';
      }
    } else if (response) {
      debuggerConnectionEl.textContent = 'Unknown';
      debuggerStatusEl.className = 'status disconnected';
      attachedTabsEl.textContent = '0';
      console.log('Popup: Debugger status failed, response:', response);
    } else {
      debuggerConnectionEl.textContent = 'No Response';
      debuggerStatusEl.className = 'status disconnected';
      attachedTabsEl.textContent = '0';
      console.log('Popup: No debugger response from service worker');
    }
  } catch (error) {
    debuggerConnectionEl.textContent = 'Error';
    debuggerStatusEl.className = 'status disconnected';
    attachedTabsEl.textContent = '0';
    console.error('Error checking debugger status:', error);
  }
}

async function handleReconnect() {
  const reconnectBtn = document.getElementById('reconnect-btn');
  const mcpConnectionEl = document.getElementById('mcp-connection');
  
  try {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'Reconnecting...';
    mcpConnectionEl.textContent = 'Reconnecting...';
    
    const response = await chrome.runtime.sendMessage({
      type: 'force_reconnect'
    });
    
    if (response && response.success) {
      // Wait a moment then refresh status
      setTimeout(async () => {
        await checkNativeHostConnection();
        await checkDebuggerStatus();
        reconnectBtn.disabled = false;
        reconnectBtn.textContent = 'Reconnect';
      }, 2000);
    } else {
      throw new Error('Reconnect failed');
    }
  } catch (error) {
    console.error('Reconnect error:', error);
    reconnectBtn.disabled = false;
    reconnectBtn.textContent = 'Reconnect';
    mcpConnectionEl.textContent = 'Reconnect Failed';
  }
}

async function handleResetDebugger() {
  const resetDebuggerBtn = document.getElementById('reset-debugger-btn');
  const debuggerConnectionEl = document.getElementById('debugger-connection');
  
  try {
    resetDebuggerBtn.disabled = true;
    resetDebuggerBtn.textContent = 'Resetting...';
    debuggerConnectionEl.textContent = 'Resetting...';
    
    const response = await chrome.runtime.sendMessage({
      type: 'reset_debugger'
    });
    
    if (response && response.success) {
      // Wait a moment then refresh status
      setTimeout(async () => {
        await checkDebuggerStatus();
        resetDebuggerBtn.disabled = false;
        resetDebuggerBtn.textContent = 'Reset Debugger';
      }, 1000);
    } else {
      throw new Error('Debugger reset failed');
    }
  } catch (error) {
    console.error('Debugger reset error:', error);
    resetDebuggerBtn.disabled = false;
    resetDebuggerBtn.textContent = 'Reset Debugger';
    debuggerConnectionEl.textContent = 'Reset Failed';
  }
}