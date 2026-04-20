import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { TransportInstance } from "./types.js";

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString()));
		req.on("error", reject);
	});
}

export class HttpTransport implements TransportInstance {
	private httpServer: Server | null = null;
	private transports: Map<string, StreamableHTTPServerTransport> = new Map();
	private createServer!: () => McpServer;

	constructor(
		private port: number = 3000,
		private host: string = "0.0.0.0",
	) {}

	get address(): AddressInfo | null {
		if (!this.httpServer) return null;
		const addr = this.httpServer.address();
		if (typeof addr === "string" || addr === null) return null;
		return addr;
	}

	async start(serverOrFactory: McpServer | (() => McpServer)): Promise<void> {
		// Support both McpServer and factory for backward compatibility with stdio transport
		if (typeof serverOrFactory === "function") {
			this.createServer = serverOrFactory;
		} else {
			// Single server mode — wrap in a factory (used by stdio transport)
			const singleServer = serverOrFactory;
			this.createServer = () => singleServer;
		}

		this.httpServer = createServer(async (req, res) => {
			// Health check endpoint
			if (req.method === "GET" && req.url === "/health") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "ok" }));
				return;
			}

			const sessionId = req.headers["mcp-session-id"] as string | undefined;

			try {
				// GET and DELETE — route to existing session transport
				if (req.method === "GET" || req.method === "DELETE") {
					if (!sessionId) {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Missing Mcp-Session-Id header" }, id: null }));
						return;
					}
					const transport = this.transports.get(sessionId);
					if (!transport) {
						res.writeHead(404, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
						return;
					}
					await transport.handleRequest(req, res);
					return;
				}

				// POST — read and parse body
				const rawBody = await readBody(req);
				let body: unknown;
				try {
					body = JSON.parse(rawBody);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
					return;
				}

				// Check if this is an initialization request
				const messages = Array.isArray(body) ? body : [body];
				const isInit = messages.some(isInitializeRequest as (msg: unknown) => boolean);

				if (isInit) {
					// New session — create fresh transport + server
					const transport = new StreamableHTTPServerTransport({
						sessionIdGenerator: () => crypto.randomUUID(),
						onsessioninitialized: (sid: string) => {
							this.transports.set(sid, transport);
						},
					});

					transport.onclose = () => {
						const sid = transport.sessionId;
						if (sid) {
							this.transports.delete(sid);
						}
					};

					const server = this.createServer();
					await server.connect(transport);
					await transport.handleRequest(req, res, body);
					return;
				}

				// Non-init POST — route to existing session
				if (!sessionId) {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Missing Mcp-Session-Id header" }, id: null }));
					return;
				}
				const transport = this.transports.get(sessionId);
				if (!transport) {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
					return;
				}
				await transport.handleRequest(req, res, body);
			} catch (err) {
				process.stderr.write(`MCP transport error: ${err instanceof Error ? err.stack : String(err)}\n`);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
				}
			}
		});

		await new Promise<void>((resolve, reject) => {
			this.httpServer?.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.port} is already in use. Choose a different port with --port.`));
				} else {
					reject(err);
				}
			});
			this.httpServer?.listen(this.port, this.host, () => {
				const addr = this.httpServer?.address() as AddressInfo;
				process.stderr.write(`MCP server started on http://${addr.address}:${addr.port}\n`);
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		// Close all active session transports
		for (const [, transport] of this.transports) {
			await transport.close();
		}
		this.transports.clear();

		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer?.close(() => resolve());
			});
		}
	}
}
