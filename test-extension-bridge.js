#!/usr/bin/env node

import { ExtensionBridge } from './dist/utils/extension-bridge.js';

console.log('Testing ExtensionBridge directly...');

try {
  const bridge = new ExtensionBridge();
  console.log('ExtensionBridge created successfully');
  console.log('Session ID:', bridge.getSessionId());
  console.log('Debug log path:', bridge.getDebugLogPath());
  
  // Wait a bit to let async operations complete
  setTimeout(() => {
    console.log('Test complete - check for startup and debug files');
    process.exit(0);
  }, 2000);
  
} catch (error) {
  console.error('Error creating ExtensionBridge:', error);
  process.exit(1);
}