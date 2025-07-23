#!/usr/bin/env bun

import { program } from 'commander';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MCPHttpOptions {
  port: number;
  mcpCommand: string;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

interface ClientSession {
  id: string;
  pendingRequests: Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timestamp: number;
  }>;
  sseController?: ReadableStreamDefaultController;
}

class MCPSubprocess {
  private process: ChildProcess | null = null;
  private command: string;
  private messageHandlers: Set<(message: JsonRpcMessage) => void> = new Set();
  private isStarting = false;
  private autoRestart = true;

  constructor(command: string) {
    this.command = command;
  }

  async start(): Promise<void> {
    if (this.isStarting) {
      return; // Already starting
    }

    if (this.process) {
      await this.stop();
    }

    this.isStarting = true;

    try {
      const [cmd, ...args] = this.command.split(' ');
      this.process = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
        throw new Error('Failed to create subprocess pipes');
      }

      // Handle stdout (messages from MCP server)
      let buffer = '';
      this.process.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message: JsonRpcMessage = JSON.parse(line);
              this.notifyHandlers(message);
            } catch (error) {
              console.error('Failed to parse JSON-RPC message:', line, error);
            }
          }
        }
      });

      // Handle stderr (logging from MCP server)
      this.process.stderr.on('data', (chunk: Buffer) => {
        // Log MCP server stderr but don't treat as error
        process.stderr.write(`[MCP Server] ${chunk.toString()}`);
      });

      // Handle process exit
      this.process.on('exit', async (code, signal) => {
        console.error(`MCP Server exited with code ${code}, signal ${signal}`);
        this.process = null;
        this.isStarting = false;

        // Auto-restart if enabled and not a clean exit
        if (this.autoRestart && code !== 0) {
          console.log('Attempting to restart MCP server in 1 second...');
          setTimeout(() => {
            this.start().catch(error => {
              console.error('Failed to restart MCP server:', error);
            });
          }, 1000);
        }
      });

      // Handle process errors
      this.process.on('error', (error) => {
        console.error('MCP Server process error:', error);
        this.process = null;
        this.isStarting = false;
      });

      // Wait for the process to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MCP server startup timeout'));
        }, 5000);

        // Consider the process ready when we can write to stdin
        if (this.process?.stdin) {
          clearTimeout(timeout);
          resolve(void 0);
        }
      });

      console.log('MCP server started successfully');
    } finally {
      this.isStarting = false;
    }
  }

  async stop(): Promise<void> {
    this.autoRestart = false;
    
    if (this.process) {
      this.process.kill('SIGTERM');
      
      // Wait up to 5 seconds for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        if (this.process) {
          this.process.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.process = null;
    }
  }

  sendMessage(message: JsonRpcMessage): void {
    if (!this.process?.stdin) {
      throw new Error('MCP subprocess not running');
    }

    try {
      const line = JSON.stringify(message) + '\n';
      this.process.stdin.write(line, 'utf8');
    } catch (error) {
      console.error('Failed to send message to MCP server:', error);
      throw error;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  addMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  removeMessageHandler(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  private notifyHandlers(message: JsonRpcMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    }
  }
}

class SessionManager {
  private sessions: Map<string, ClientSession> = new Map();

  createSession(): ClientSession {
    const id = crypto.randomUUID();
    const session: ClientSession = {
      id,
      pendingRequests: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): ClientSession | undefined {
    return this.sessions.get(id);
  }

  deleteSession(id: string): void {
    const session = this.sessions.get(id);
    if (session?.sseController) {
      try {
        session.sseController.close();
      } catch (error) {
        // Ignore close errors
      }
    }
    
    // Reject all pending requests
    for (const [requestId, request] of session.pendingRequests.entries()) {
      request.reject(new Error('Session terminated'));
    }
    
    this.sessions.delete(id);
  }

  getAllSessions(): ClientSession[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  addPendingRequest(sessionId: string, requestId: string | number, resolve: (value: any) => void, reject: (error: any) => void): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.pendingRequests.set(requestId, {
        resolve,
        reject,
        timestamp: Date.now(),
      });
    }
  }

  resolvePendingRequest(sessionId: string, requestId: string | number, result: any): boolean {
    const session = this.getSession(sessionId);
    if (session) {
      const pending = session.pendingRequests.get(requestId);
      if (pending) {
        pending.resolve(result);
        session.pendingRequests.delete(requestId);
        return true;
      }
    }
    return false;
  }

  rejectPendingRequest(sessionId: string, requestId: string | number, error: any): boolean {
    const session = this.getSession(sessionId);
    if (session) {
      const pending = session.pendingRequests.get(requestId);
      if (pending) {
        pending.reject(error);
        session.pendingRequests.delete(requestId);
        return true;
      }
    }
    return false;
  }

  cleanup(): void {
    // Clean up old pending requests (older than 30 seconds)
    const now = Date.now();
    for (const session of this.sessions.values()) {
      for (const [requestId, request] of session.pendingRequests.entries()) {
        if (now - request.timestamp > 30000) {
          request.reject(new Error('Request timeout'));
          session.pendingRequests.delete(requestId);
        }
      }
    }
  }
}

class MCPHttpWrapper {
  private subprocess: MCPSubprocess;
  private sessionManager: SessionManager;
  private options: MCPHttpOptions;

  constructor(options: MCPHttpOptions) {
    this.options = options;
    this.subprocess = new MCPSubprocess(options.mcpCommand);
    this.sessionManager = new SessionManager();

    // Set up message routing from subprocess to sessions
    this.subprocess.addMessageHandler(this.handleSubprocessMessage.bind(this));

    // Clean up old requests periodically
    setInterval(() => this.sessionManager.cleanup(), 10000);
  }

  async start(): Promise<void> {
    await this.subprocess.start();

    const server = Bun.serve({
      port: this.options.port,
      fetch: this.handleRequest.bind(this),
    });

    console.log(`MCP HTTP wrapper listening on port ${this.options.port}`);
    console.log(`Proxying to MCP command: ${this.options.mcpCommand}`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down MCP HTTP wrapper...');
      
      // Close all sessions
      for (const session of this.sessionManager.getAllSessions()) {
        this.sessionManager.deleteSession(session.id);
      }
      
      // Stop subprocess
      await this.subprocess.stop();
      
      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Only handle /mcp endpoint
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      switch (request.method) {
        case 'POST':
          return await this.handlePost(request);
        case 'GET':
          return await this.handleGet(request);
        case 'DELETE':
          return await this.handleDelete(request);
        case 'OPTIONS':
          return this.handleOptions();
        default:
          return new Response('Method Not Allowed', { status: 405 });
      }
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async handlePost(request: Request): Promise<Response> {
    // Validate Accept header
    const acceptHeader = request.headers.get('Accept');
    if (!acceptHeader || (!acceptHeader.includes('application/json') && !acceptHeader.includes('text/event-stream'))) {
      return new Response('Must accept application/json and/or text/event-stream', { status: 400 });
    }

    // Get or create session
    const sessionIdHeader = request.headers.get('Mcp-Session-Id');
    let session: ClientSession;
    
    if (sessionIdHeader) {
      const existingSession = this.sessionManager.getSession(sessionIdHeader);
      if (!existingSession) {
        return new Response('Session not found', { status: 404 });
      }
      session = existingSession;
    } else {
      session = this.sessionManager.createSession();
    }

    try {
      // Parse request body
      let requestBody: JsonRpcMessage | JsonRpcMessage[];
      try {
        requestBody = await request.json();
      } catch (error) {
        return new Response('Invalid JSON', { status: 400 });
      }

      // Normalize to array
      const messages = Array.isArray(requestBody) ? requestBody : [requestBody];
      
      // Validate messages
      for (const message of messages) {
        if (!message.jsonrpc || message.jsonrpc !== '2.0') {
          return new Response('Invalid JSON-RPC format', { status: 400 });
        }
      }

      // Check if all messages are responses/notifications (no requests)
      const hasRequests = messages.some(msg => msg.method && msg.id !== undefined);
      const isInitialization = messages.some(msg => msg.method === 'initialize');

      if (!hasRequests) {
        // Only responses/notifications - forward to subprocess and return 202
        for (const message of messages) {
          this.subprocess.sendMessage(message);
        }
        return new Response(null, { status: 202 });
      }

      // Has requests - need to handle responses
      const responsePromises: Promise<JsonRpcMessage>[] = [];
      
      for (const message of messages) {
        if (message.method && message.id !== undefined) {
          // This is a request - add to pending and create promise
          const responsePromise = new Promise<JsonRpcMessage>((resolve, reject) => {
            this.sessionManager.addPendingRequest(session.id, message.id!, resolve, reject);
          });
          responsePromises.push(responsePromise);
          
          // Forward to subprocess
          this.subprocess.sendMessage(message);
        } else {
          // Notification or response - just forward
          this.subprocess.sendMessage(message);
        }
      }

      // If client prefers SSE or this is not initialization, use SSE
      const prefersSSE = acceptHeader.includes('text/event-stream');
      
      if (prefersSSE && !isInitialization) {
        // Return SSE stream
        const stream = new ReadableStream({
          start(controller) {
            session.sseController = controller;
            
            // Send responses as they come in
            Promise.allSettled(responsePromises).then(results => {
              for (const result of results) {
                if (result.status === 'fulfilled') {
                  const sseData = `data: ${JSON.stringify(result.value)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(sseData));
                } else {
                  const errorResponse = {
                    jsonrpc: '2.0' as const,
                    id: null,
                    error: { code: -32603, message: result.reason?.message || 'Internal error' }
                  };
                  const sseData = `data: ${JSON.stringify(errorResponse)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(sseData));
                }
              }
              controller.close();
              session.sseController = undefined;
            });
          },
          cancel() {
            session.sseController = undefined;
          }
        });

        const headers: Record<string, string> = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        };

        // Add session ID header for initialization
        if (isInitialization) {
          headers['Mcp-Session-Id'] = session.id;
        }

        return new Response(stream, { headers });
      } else {
        // Return JSON response (for initialization or if JSON preferred)
        const responses = await Promise.allSettled(responsePromises);
        const jsonResponses: JsonRpcMessage[] = [];
        
        for (const result of responses) {
          if (result.status === 'fulfilled') {
            jsonResponses.push(result.value);
          } else {
            jsonResponses.push({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: result.reason?.message || 'Internal error' }
            });
          }
        }

        const responseBody = jsonResponses.length === 1 ? jsonResponses[0] : jsonResponses;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add session ID header for initialization
        if (isInitialization) {
          headers['Mcp-Session-Id'] = session.id;
        }

        return new Response(JSON.stringify(responseBody), { headers });
      }

    } catch (error) {
      console.error('Error handling POST request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async handleGet(request: Request): Response {
    // Validate Accept header for SSE
    const acceptHeader = request.headers.get('Accept');
    if (!acceptHeader || !acceptHeader.includes('text/event-stream')) {
      return new Response('Must accept text/event-stream', { status: 400 });
    }

    // Get session (required for GET requests per spec)
    const sessionIdHeader = request.headers.get('Mcp-Session-Id');
    if (!sessionIdHeader) {
      return new Response('Mcp-Session-Id header required', { status: 400 });
    }

    const session = this.sessionManager.getSession(sessionIdHeader);
    if (!session) {
      return new Response('Session not found', { status: 404 });
    }

    // Handle Last-Event-ID for resumability (optional)
    const lastEventId = request.headers.get('Last-Event-ID');
    
    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Store controller in session for server-initiated messages
        session.sseController = controller;

        // Send initial connection established event
        const connectData = 'data: {"type":"connection_established"}\n\n';
        controller.enqueue(new TextEncoder().encode(connectData));

        // If resuming from last event ID, we could replay messages here
        // but for now we just start fresh
        if (lastEventId) {
          console.log(`Resuming SSE stream from event ID: ${lastEventId}`);
        }
      },
      cancel() {
        // Clean up when client disconnects
        session.sseController = undefined;
        console.log(`SSE stream cancelled for session: ${session.id}`);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Last-Event-ID',
      },
    });
  }

  private async handleDelete(request: Request): Promise<Response> {
    // Get session ID from header
    const sessionIdHeader = request.headers.get('Mcp-Session-Id');
    if (!sessionIdHeader) {
      return new Response('Mcp-Session-Id header required', { status: 400 });
    }

    const session = this.sessionManager.getSession(sessionIdHeader);
    if (!session) {
      return new Response('Session not found', { status: 404 });
    }

    // Terminate the session
    this.sessionManager.deleteSession(sessionIdHeader);
    console.log(`Session terminated: ${sessionIdHeader}`);

    return new Response(null, { status: 204 });
  }

  private handleOptions(): Response {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Last-Event-ID',
      },
    });
  }

  private handleSubprocessMessage(message: JsonRpcMessage): void {
    // Handle responses (have an id and either result or error)
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      // This is a response - find the session that sent the corresponding request
      let handled = false;
      for (const session of this.sessionManager.getAllSessions()) {
        if (message.error) {
          if (this.sessionManager.rejectPendingRequest(session.id, message.id, new Error(message.error.message || 'Unknown error'))) {
            handled = true;
            break;
          }
        } else {
          if (this.sessionManager.resolvePendingRequest(session.id, message.id, message)) {
            handled = true;
            break;
          }
        }
      }
      
      if (!handled) {
        console.warn('Received response for unknown request ID:', message.id);
      }
      return;
    }

    // Handle notifications and requests from server (no id or method present)
    // These should be broadcast to all active SSE streams
    for (const session of this.sessionManager.getAllSessions()) {
      if (session.sseController) {
        try {
          const sseData = `data: ${JSON.stringify(message)}\n\n`;
          session.sseController.enqueue(new TextEncoder().encode(sseData));
        } catch (error) {
          console.error('Failed to send SSE message to session:', session.id, error);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  program
    .name('mcp-http')
    .description('HTTP wrapper for STDIO MCP servers')
    .option('-p, --port <number>', 'HTTP listen port', '3000')
    .option('-c, --mcp-command <string>', 'MCP server command', `bun ${path.join(__dirname, 'index.ts')}`)
    .parse();

  const options = program.opts();
  const mcpOptions: MCPHttpOptions = {
    port: parseInt(options.port, 10),
    mcpCommand: options.mcpCommand,
  };

  const wrapper = new MCPHttpWrapper(mcpOptions);
  await wrapper.start();
}

if (import.meta.main) {
  main().catch(console.error);
}