// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/aviator/hub.ts
import { WebSocket, Server as WSServer } from "ws";
import { AviatorEngine } from "./engine";

interface ClientSession {
  userId: string;
  ws: WebSocket;
}

/**
 * Aviator Hub
 * Manages room-based game instances and WebSocket routing
 * Each room has its own isolated AviatorEngine
 */
export class AviatorHub {
  private engine: AviatorEngine;
  private clients: Map<string, ClientSession> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(wss: WSServer) {
    this.engine = new AviatorEngine();

    // Setup event handlers
    this.engine.on("broadcast", (message) => {
      this.broadcastToAll(message);
    });

    // Start tick loop (20Hz)
    this.tickInterval = setInterval(() => {
      this.engine.onTick();
    }, 50);

    // Handle WebSocket connections
    wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => {
        this.handleMessage(ws, data);
      });

      ws.on("close", () => {
        this.handleDisconnect(ws);
      });
    });
  }

  private async handleMessage(ws: WebSocket, data: Buffer) {
    try {
      const message = JSON.parse(data.toString());

      // Handle join
      if (message.type === "join") {
        await this.handleJoin(ws, message);
        return;
      }

      // Get session
      const session = Array.from(this.clients.values()).find(
        (c) => c.ws === ws,
      );
      if (!session) {
        ws.send(JSON.stringify({ error: "Not authenticated" }));
        return;
      }

      // Handle action
      await this.engine.handleAction(
        ws,
        message.action,
        session.userId,
        message.payload || {},
      );
    } catch (error) {
      console.error("[Aviator Hub] Error:", error);
      ws.send(JSON.stringify({ error: "Internal error" }));
    }
  }

  private async handleJoin(ws: WebSocket, message: any) {
    const userId = message.userId;

    if (!userId) {
      ws.send(JSON.stringify({ error: "user_id required" }));
      return;
    }

    // Store session
    this.clients.set(userId, { userId, ws });

    ws.send(
      JSON.stringify({
        type: "welcome",
        playerId: userId,
        state: {
          status: this.engine.status,
          multiplier: this.engine.multiplier,
        },
      }),
    );
  }

  private handleDisconnect(ws: WebSocket) {
    const session = Array.from(this.clients.values()).find((c) => c.ws === ws);
    if (!session) return;

    this.engine.handleDisconnect(session.userId);
    this.clients.delete(session.userId);
  }

  private broadcastToAll(message: any) {
    const payload = JSON.stringify(message);
    for (const session of this.clients.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(payload);
      }
    }
  }

  public destroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
}
