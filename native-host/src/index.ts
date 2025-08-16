#!/usr/bin/env node
/**
 * Browser Pilot Native Messaging Host
 * 
 * This application serves as a bridge between:
 * 1. The Chrome extension (via Native Messaging API)
 * 2. Multiple Browser Pilot MCP servers (via WebSockets)
 * 
 * It receives messages from the Chrome extension through stdin,
 * and from MCP servers through WebSockets, then routes these
 * messages appropriately between the connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as os from 'os';

// Get the current directory for file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const WS_PORT = 9876;
const VERSION = '1.0.0';
const LOG_FILE = join(os.tmpdir(), `browser-pilot-host-${randomUUID()}.log`);

// Interfaces
interface NativeMessage {
  type: string;
  data: any;
  id?: string;
  target?: string;
  source?: string;
}

interface MpcClient {
  id: string;
  ws: WebSocket;
  sessionStarted: number;
  name?: string;
}

// State management
const mpcClients: Map<string, MpcClient> = new Map();
let extensionConnected = false;
let lastExtensionMessage = 0;
let shuttingDown = false;

/**
 * Log to file with timestamp
 */
async function logToFile(message: string, data?: any): Promise<void> {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
  
  try {
    await fs.appendFile(LOG_FILE, logEntry);
  } catch (error) {
    // Can't log to file, so try to report to stderr if possible
    process.stderr.write(`Error writing to log: ${error}\n`);
  }
}

/**
 * Send a message to the Chrome extension via stdout
 */
function sendToExtension(message: NativeMessage): void {
  try {
    // Native messaging protocol requires 4-byte length prefix in native byte order
    const messageJson = JSON.stringify(message);
    const messageBuffer = Buffer.from(messageJson);
    const headerBuffer = Buffer.alloc(4);

    headerBuffer.writeUInt32LE(messageBuffer.length, 0);
    process.stdout.write(Buffer.concat([headerBuffer, messageBuffer]));
    
    // Log outgoing message
    logToFile('SENT TO EXTENSION', message).catch(() => {});
  } catch (error) {
    logToFile('ERROR sending to extension', { error }).catch(() => {});
  }
}

/**
 * Initialize the WebSocket server for MCP clients
 */
function initializeWebSocketServer(): void {
  const httpServer = createServer();
  const wsServer = new WebSocketServer({ server: httpServer });

  wsServer.on('connection', (ws: WebSocket) => {
    const clientId = randomUUID();
    
    // Add new client
    const client: MpcClient = {
      id: clientId,
      ws,
      sessionStarted: Date.now()
    };
    
    mpcClients.set(clientId, client);
    
    logToFile('MCP client connected', { clientId }).catch(() => {});
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      data: {
        clientId,
        extensionConnected,
        version: VERSION
      }
    }));
    
    // Notify extension of new connection
    if (extensionConnected) {
      sendToExtension({
        type: 'mcp_client_connected',
        data: {
          clientId,
          timestamp: Date.now()
        }
      });
    }
    
    // Listen for messages from this MCP client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as NativeMessage;
        
        // Add source information
        message.source = clientId;
        
        logToFile('RECEIVED FROM MCP', message).catch(() => {});
        
        // Forward to extension
        if (extensionConnected) {
          sendToExtension(message);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            data: {
              message: 'Extension not connected',
              originalMessage: message
            }
          }));
        }
      } catch (error) {
        logToFile('ERROR parsing MCP message', { error, rawData: data.toString() }).catch(() => {});
      }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
      mpcClients.delete(clientId);
      logToFile('MCP client disconnected', { clientId }).catch(() => {});
      
      // Notify extension
      if (extensionConnected) {
        sendToExtension({
          type: 'mcp_client_disconnected',
          data: {
            clientId,
            timestamp: Date.now()
          }
        });
      }
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logToFile('MCP client error', { clientId, error: error.message }).catch(() => {});
      mpcClients.delete(clientId);
    });
  });

  // Start the WebSocket server
  httpServer.listen(WS_PORT, () => {
    logToFile(`WebSocket server started on port ${WS_PORT}`).catch(() => {});
  });

  // Handle server errors
  httpServer.on('error', (error) => {
    logToFile('WebSocket server error', { error: error.message }).catch(() => {});
    
    // Try to recover by attempting on a different port if this was a port conflict
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logToFile(`Port ${WS_PORT} in use, trying another port`).catch(() => {});
      
      // For now we just log the error - in a future version we could try other ports
    }
  });
}

/**
 * Handle messages from the Chrome extension via stdin
 */
async function readNativeMessages(): Promise<void> {
  // Node.js buffer to accumulate incoming message data
  let buffer = Buffer.alloc(0);
  
  // Expected length of the current message (0 means waiting for header)
  let expectedLength = 0;
  
  // Read binary data from stdin
  process.stdin.on('readable', () => {
    let chunk;
    
    // Read all available data
    while ((chunk = process.stdin.read()) !== null) {
      // Append new data to our buffer
      buffer = Buffer.concat([buffer, chunk]);
      
      // Process complete messages
      while (buffer.length > 0) {
        // If we don't have a length yet, and we have enough bytes for the length prefix
        if (expectedLength === 0 && buffer.length >= 4) {
          // Read the message length (first 4 bytes as uint32)
          expectedLength = buffer.readUInt32LE(0);
          // Remove the length bytes from the buffer
          buffer = buffer.subarray(4);
        }
        
        // If we have a length and enough data, process the message
        if (expectedLength > 0 && buffer.length >= expectedLength) {
          const messageBuffer = buffer.subarray(0, expectedLength);
          buffer = buffer.subarray(expectedLength);
          
          try {
            const message = JSON.parse(messageBuffer.toString()) as NativeMessage;
            
            // Process the message
            handleExtensionMessage(message);
          } catch (error) {
            logToFile('ERROR parsing extension message', { 
              error: error instanceof Error ? error.message : String(error),
              messageBuffer: messageBuffer.toString('hex')
            }).catch(() => {});
          }
          
          // Reset expected length for the next message
          expectedLength = 0;
        } else {
          // We don't have enough data yet, wait for more
          break;
        }
      }
    }
  });
  
  // Handle end of stream (extension disconnected)
  process.stdin.on('end', () => {
    logToFile('Extension disconnected (stdin closed)').catch(() => {});
    handleExtensionDisconnect();
  });
  
  // Handle errors
  process.stdin.on('error', (error) => {
    logToFile('Extension stdin error', { error: error.message }).catch(() => {});
    handleExtensionDisconnect();
  });
}

/**
 * Handle messages received from the Chrome extension
 */
function handleExtensionMessage(message: NativeMessage): void {
  // Update extension connection state
  extensionConnected = true;
  lastExtensionMessage = Date.now();
  
  // Log incoming message
  logToFile('RECEIVED FROM EXTENSION', message).catch(() => {});
  
  // Handle message based on type
  switch (message.type) {
    case 'ping':
      // Respond with pong
      sendToExtension({
        type: 'pong',
        id: message.id,
        data: {
          timestamp: Date.now(),
          mpcClientCount: mpcClients.size
        }
      });
      break;
      
    case 'extension_info':
      // Just log this info
      logToFile('Extension info received', message.data).catch(() => {});
      break;
      
    default:
      // For all other messages, route to target MCP client if specified
      if (message.target && mpcClients.has(message.target)) {
        const client = mpcClients.get(message.target)!;
        
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(message));
        } else {
          logToFile('Cannot forward message to MCP client (not connected)', { 
            clientId: client.id 
          }).catch(() => {});
        }
      } 
      // If no target or target not found, broadcast to all MPC clients
      else if (!message.target) {
        broadcastToMpcClients(message);
      } else {
        logToFile('Target MCP client not found', { 
          targetId: message.target,
          availableClients: Array.from(mpcClients.keys())
        }).catch(() => {});
      }
      break;
  }
}

/**
 * Handle extension disconnection
 */
function handleExtensionDisconnect(): void {
  // Log disconnection
  logToFile('Extension disconnected').catch(() => {});
  
  // Update state
  extensionConnected = false;
  
  // Notify all MPC clients
  broadcastToMpcClients({
    type: 'extension_disconnected',
    data: {
      timestamp: Date.now()
    }
  });
  
  // If shutting down, exit process
  if (shuttingDown) {
    process.exit(0);
  }
}

/**
 * Broadcast a message to all connected MPC clients
 */
function broadcastToMpcClients(message: NativeMessage): void {
  const messageJson = JSON.stringify(message);
  const activeClientCount = mpcClients.size;
  let sentCount = 0;
  
  // Send to all connected clients
  mpcClients.forEach((client, clientId) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(messageJson);
        sentCount++;
      } catch (error) {
        logToFile('ERROR broadcasting to MPC client', { 
          clientId, 
          error: error instanceof Error ? error.message : String(error) 
        }).catch(() => {});
      }
    }
  });
  
  // Log broadcast summary
  if (sentCount > 0) {
    logToFile(`Broadcast message to ${sentCount}/${activeClientCount} MCP clients`, { 
      type: message.type 
    }).catch(() => {});
  }
}

/**
 * Setup clean exit handling
 */
function setupCleanExit(): void {
  // Handle termination signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle process exit
  process.on('exit', (code) => {
    logToFile(`Process exiting with code ${code}`).catch(() => {});
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logToFile('UNCAUGHT EXCEPTION', { 
      error: error.stack || error.message 
    }).catch(() => {
      // Last resort error reporting
      process.stderr.write(`Uncaught exception: ${error}\n`);
    });
    
    // Exit with error
    process.exit(1);
  });
}

/**
 * Gracefully shut down the host
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // Prevent multiple shutdown attempts
  
  shuttingDown = true;
  logToFile(`Received ${signal}, shutting down gracefully`).catch(() => {});
  
  // Notify MPC clients
  broadcastToMpcClients({
    type: 'host_shutting_down',
    data: {
      signal,
      timestamp: Date.now()
    }
  });
  
  // Notify extension
  if (extensionConnected) {
    sendToExtension({
      type: 'host_shutting_down',
      data: {
        signal,
        timestamp: Date.now()
      }
    });
  }
  
  // Allow time for messages to be sent
  setTimeout(() => {
    process.exit(0);
  }, 500);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Create log directory if needed
    await logToFile('Browser Pilot Native Messaging Host starting', { 
      version: VERSION,
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    });
    
    // Initialize WebSocket server for MCP clients
    initializeWebSocketServer();
    
    // Listen for messages from the Chrome extension
    readNativeMessages();
    
    // Setup clean exit handlers
    setupCleanExit();
    
    // Log startup
    await logToFile('Browser Pilot Native Messaging Host started successfully', {
      logFile: LOG_FILE,
      wsPort: WS_PORT
    });
  } catch (error) {
    await logToFile('STARTUP ERROR', { 
      error: error instanceof Error ? error.stack : String(error) 
    });
    process.exit(1);
  }
}

// Start the host
main().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});