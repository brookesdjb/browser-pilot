# Enhanced Browser MCP

A comprehensive MCP server for browser automation with full DevTools access, storage inspection, network monitoring, and advanced browser capabilities.

## Features

### Core Automation
- ✅ Click, type, hover, drag & drop
- ✅ Navigation (URLs, back/forward, refresh)
- ✅ Screenshots and DOM snapshots
- ✅ Keyboard input and key combinations

### Advanced Capabilities (vs browsermcp)
- 🚀 **Full Storage Access**: localStorage, sessionStorage, cookies, IndexedDB
- 🚀 **Network Monitoring**: HTTP requests/responses, headers, timing
- 🚀 **Console Logs**: Real-time console output, errors, warnings
- 🚀 **DevTools Integration**: Performance metrics, security info, debugging
- 🚀 **Tab Management**: Multiple tabs, windows, focus control
- 🚀 **Advanced Interactions**: File uploads, downloads, form handling

## Architecture

```
enhanced-browser-mcp/
├── src/                    # MCP Server (Node.js/TypeScript)
│   ├── server/            # MCP server implementation
│   ├── tools/             # Browser automation tools
│   ├── types/             # TypeScript definitions
│   └── utils/             # Utilities and helpers
├── extension/             # Chrome Extension
│   ├── background/        # Service worker & DevTools API
│   ├── content/           # Page injection scripts
│   ├── popup/             # Extension popup UI
│   └── devtools/          # DevTools panel integration
└── docs/                  # Documentation
```

## Development Status

🚧 **In Development** - Building enhanced browser automation capabilities

## License

MIT