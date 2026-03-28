// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/aviator/hub.ts
import { WebSocket, Server as WSServer } from "ws";
import { AviatorEngine } from "./engine";
import { sessionManager } from "../../utils/sessionManager";
import { CocobaseHelper } from "../../core/cocobase";
import { Wallet } from "../../types/documents";

interface ClientSession {
  userId: string;
  ws: WebSocket;
  wallet: Wallet;
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
    const MIN_BALANCE = 0.01; // Minimum balance to play (in coins)

    console.log("all sessions ", sessionManager.getAllSessions());
    if (!userId) {
      ws.send(JSON.stringify({ error: "user_id required" }));
      return;
    }

    // Check if user is already in another game
    if (sessionManager.isUserInGame(userId)) {
      const existingSession = sessionManager.getUserSession(userId);
      ws.send(
        JSON.stringify({
          error: `User already in ${existingSession?.gameType} game. Leave that game first.`,
          code: "USER_ALREADY_IN_GAME",
        }),
      );
      ws.close(1008, "User already in another game");
      return;
    }

    // Fetch wallet from database
    const wallet = await CocobaseHelper.getWallet(userId);
    if (!wallet) {
      ws.send(
        JSON.stringify({
          error: "Wallet not found",
          code: "WALLET_NOT_FOUND",
        }),
      );
      ws.close(1008, "Wallet not found");
      return;
    }

    // Check minimum balance
    if (wallet.coins_balance < MIN_BALANCE) {
      ws.send(
        JSON.stringify({
          error: `Insufficient balance. Minimum required: ${MIN_BALANCE} coins. Your balance: ${wallet.coins_balance}`,
          code: "INSUFFICIENT_BALANCE",
          balance: wallet.coins_balance,
          minRequired: MIN_BALANCE,
        }),
      );
      ws.close(1008, "Insufficient balance");
      return;
    }

    // Register user in this game
    const wsId = `aviator_${userId}_${Date.now()}`;
    const registered = sessionManager.registerUser(userId, "aviator", wsId);

    if (!registered) {
      ws.send(
        JSON.stringify({
          error: "Failed to register user session",
          code: "SESSION_REGISTRATION_FAILED",
        }),
      );
      ws.close(1011, "Failed to register session");
      return;
    }

    // Store session with wallet
    this.clients.set(userId, { userId, ws, wallet });

    ws.send(
      JSON.stringify({
        type: "welcome",
        playerId: userId,
        wallet: {
          balance: wallet.coins_balance,
          usdt: wallet.usdt,
        },
        user: wallet.user,
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
    sessionManager.unregisterUser(session.userId);
  }

  private broadcastToAll(message: any) {
    // Enrich broadcast message with full player data if it contains a playerId
    const enrichedMessage = { ...message };

    if (message.playerId && this.clients.has(message.playerId)) {
      const session = this.clients.get(message.playerId)!;
      enrichedMessage.player = {
        userId: session.userId,
        wallet: {
          balance: session.wallet.coins_balance,
          usdt: session.wallet.usdt,
        },
        user: session.wallet.user,
      };
    }

    const payload = JSON.stringify(enrichedMessage);
    for (const session of this.clients.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(payload);
      }
    }
  }

  public handleConnection(ws: WebSocket, request: any) {
    ws.on("message", (data: Buffer) => {
      this.handleMessage(ws, data);
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });
  }

  public shutdown() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  public destroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
}
