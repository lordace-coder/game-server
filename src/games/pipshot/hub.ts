// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/pipshot/hub.ts
import { WebSocket, Server as WSServer } from "ws";
import { PipShotEngine } from "./engine";

interface ClientSession {
  userId: string;
  username: string;
  betAmount: number;
  ws: WebSocket;
}

/**
 * PipShot Hub
 * Manages room-based game instances and WebSocket routing
 * Each room has its own isolated PipShotEngine
 */
export class PipShotHub {
  private engine: PipShotEngine;
  private clients: Map<string, ClientSession> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(wss: WSServer) {
    this.engine = new PipShotEngine();

    // Setup event handlers
    this.engine.on("broadcast", (message) => {
      this.broadcastToAll(message);
    });

    // Start tick loop
    this.tickInterval = setInterval(() => {
      this.engine.onTick();
    }, 20);

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
      console.error("[PipShot Hub] Error:", error);
      ws.send(JSON.stringify({ error: "Internal error" }));
    }
  }

  private async handleJoin(ws: WebSocket, message: any) {
    const userId = message.userId;
    const username = message.username || `Player_${userId.slice(0, 6)}`;
    const betAmount = message.betAmount || 5.0;

    if (!userId) {
      ws.send(JSON.stringify({ error: "user_id required" }));
      return;
    }

    if (betAmount <= 0 || betAmount > 1000) {
      ws.send(
        JSON.stringify({ error: "Invalid bet amount (0.01 - 1000 USD)" }),
      );
      return;
    }

    // Store session
    this.clients.set(userId, {
      userId,
      username,
      betAmount,
      ws,
    });

    // Add player to engine
    this.engine.addPlayer(userId, username, betAmount);

    ws.send(
      JSON.stringify({
        type: "welcome",
        playerId: userId,
        betAmount: betAmount,
        totalRounds: 5,
        state: this.engine.getSafeState(userId),
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
