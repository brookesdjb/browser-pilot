# Browser Pilot

A comprehensive browser automation solution with Chrome DevTools integration, designed for AI assistants using the Model Context Protocol.

## Features

### Core Automation
- ✅ Click, type, hover, and element interaction
- ✅ Navigation (URLs, back/forward, refresh)
- ✅ Screenshots and DOM snapshots
- ✅ Keyboard input and form submission

### Advanced Capabilities
- 🚀 **Full Storage Access**: localStorage, sessionStorage, cookies
- 🚀 **Network Monitoring**: HTTP requests/responses, headers, timing
- 🚀 **Console Logs**: Real-time console output, errors, warnings
- 🚀 **DevTools Integration**: Performance metrics and debugging
- 🚀 **Cross-Platform**: Works on Windows, macOS, and Linux
- 🚀 **Multi-Instance Support**: Run multiple AI assistants with a single browser

## Architecture

Browser Pilot uses Chrome's Native Messaging API for reliable, secure communication between MCP clients and the browser:

```
┌─────────────────┐     ┌────────────────────┐     ┌─────────────────┐
│    MCP Client   │     │  Browser Pilot     │     │     Chrome      │
│   (Claude Code) │◄───►│  Native Host       │◄───►│    Extension     │
└─────────────────┘     └────────────────────┘     └─────────────────┘
                                                         ▲
┌─────────────────┐                                      │
│    MCP Client   │                                      │
│   (Other LLM)   │◄─────────────────────────────────────┘
└─────────────────┘
```

This architecture ensures:
- Multiple AI assistants can connect simultaneously
- No port conflicts or connection state issues
- Reliable cross-platform operation
- Secure communication via Chrome's permission model

## Installation

### Prerequisites
- Google Chrome browser
- Node.js 18+ and npm

### Automatic Installation

Run the installer script for your platform:

**macOS/Linux:**
```bash
# Clone the repository
git clone https://github.com/brookesdjb/browser-pilot.git
cd browser-pilot

# Run installer
chmod +x install.sh
./install.sh
```

**Windows:**
```powershell
# Clone the repository
git clone https://github.com/brookesdjb/browser-pilot.git
cd browser-pilot

# Run installer (in Administrator PowerShell)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Manual Installation

1. Build the MCP server:
```bash
npm install
npm run build
```

2. Build the native host:
```bash
cd native-host
npm install
npm run build
cd ..
```

3. Install the native host:
```bash
# macOS/Linux
bash ./native-host/scripts/install_host.sh

# Windows (Administrator PowerShell)
powershell -ExecutionPolicy Bypass -File .\native-host\scripts\install_host.ps1
```

4. Install the Chrome extension:
   - Open Chrome and go to `chrome://extensions`
   - Enable Developer Mode
   - Click "Load unpacked" and select the `extension` folder

## Usage

### With Claude Code

1. Start Chrome with the Browser Pilot extension installed
2. Run the Browser Pilot server:
```bash
npx browser-pilot
```
3. Use Claude Code with any browsing tasks

### API Usage

```javascript
import browserPilot from 'browser-pilot';

// Connect to the browser
await browserPilot.connect();

// Navigate to a URL
await browserPilot.navigateToUrl('https://example.com');

// Take a screenshot
const screenshot = await browserPilot.takeScreenshot();

// Click an element
await browserPilot.clickElement({ selector: '#login-button' });

// Type text
await browserPilot.typeText({
  selector: 'input[name="search"]',
  textToType: 'browser automation',
  submit: true
});
```

## Development

To modify the codebase and build from source:

```bash
# Clone the repository
git clone https://github.com/brookesdjb/browser-pilot.git
cd browser-pilot

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev
```

## License

MIT