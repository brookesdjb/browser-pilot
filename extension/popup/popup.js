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
      
      // Check connection statuses
      await checkNativeHostConnection();
      await checkDebuggerStatus();
      
    } else {
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

async function checkDebuggerStatus() {
  const debuggerStatusEl = document.getElementById('debugger-status');
  const debuggerConnectionEl = document.getElementById('debugger-connection');
  const attachedTabsEl = document.getElementById('attached-tabs');
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'get_debugger_status'
    });
    
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
    } else {
      debuggerConnectionEl.textContent = 'Unknown';
      debuggerStatusEl.className = 'status disconnected';
      attachedTabsEl.textContent = '0';
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