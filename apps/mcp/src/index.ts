#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

// Default public instance — users can override with env vars
const url = process.env.UPSTASH_REDIS_REST_URL || 'https://current-wasp-67710.upstash.io';
const token = process.env.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAQh-AAIncDE0MTY0MDY0NDdiOWE0ODE5YTVhMzJmNmNlZTk0MTM3OHAxNjc3MTA';

const server = new Server(
  { name: 'ai-room', version: '0.1.0' },
  { capabilities: { tools: {}, logging: {} } }
);

registerTools(server, { url, token });

const transport = new StdioServerTransport();
await server.connect(transport);
