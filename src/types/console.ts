export interface ConsoleLogEntry {
  id: string;
  tabId: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  url: string;
  lineNumber?: number;
  stackTrace?: any;
}

export interface GetConsoleLogsParams {
  tabId?: number;
  limit?: number;
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug';
  since?: number;
}