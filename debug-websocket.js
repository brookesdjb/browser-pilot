#!/usr/bin/env node

import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:8899');

ws.on('open', function open() {
  console.log('Connected to extension WebSocket');
  console.log('Listening for messages...\n');
});

ws.on('message', function message(data) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Raw message:`, data.toString());
  
  try {
    const parsed = JSON.parse(data.toString());
    console.log(`[${timestamp}] Parsed:`, JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log(`[${timestamp}] Could not parse as JSON`);
  }
  console.log('---\n');
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

ws.on('close', function close() {
  console.log('WebSocket connection closed');
});