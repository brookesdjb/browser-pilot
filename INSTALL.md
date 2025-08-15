# Enhanced Browser MCP - Installation & Testing

## MVP Features
✅ **Console Logs Tool**: Access browser console logs via MCP
- Captures console.log, console.error, console.warn, console.info
- Filters by level, tab, timestamp
- Real-time collection via Chrome DevTools API

## Installation

### 1. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` folder from this project
5. The extension should appear in your toolbar

### 2. Build MCP Server

```bash
npm install
npm run build
```

### 3. Test the Extension

1. Open any webpage (e.g., https://example.com)
2. Open DevTools (F12) and go to Console
3. Type some console commands:
   ```javascript
   console.log("Hello MCP!")
   console.warn("This is a warning")
   console.error("This is an error")
   ```
4. Click the extension icon to see status and log count

### 4. Test MCP Server

```bash
# Run the MCP server
npm start

# In another terminal, test the console logs tool
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm start
```

## Architecture

```
Browser Tab ← Chrome Extension ← MCP Server ← AI Client
     ↓              ↓                ↓
Console Logs → DevTools API → get_console_logs tool
```

## Current Limitations (MVP)
- Mock data for now (will connect to real extension in next iteration)
- Basic error handling
- Single tool implementation

## Next Steps
1. Real-time WebSocket communication between extension and MCP server
2. Add storage access tools (localStorage, sessionStorage, cookies)
3. Add network monitoring tools
4. Add screenshot and DOM snapshot tools