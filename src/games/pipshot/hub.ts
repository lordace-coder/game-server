// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/pipshot/hub.ts
import { WebSocket, Server as WSServer } from "ws";
import { PipShotEngine } from "./engine";
import { sessionManager } from "../../utils/sessionManager";
import { CocobaseHelper } from "../../core/cocobase";
import { Wallet } from "../../types/documents";

interface ClientSession {
  userId: string;
  username: string;
  betAmount: number;
  ws: WebSocket;
  wallet: Wallet;
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
    const MIN_BALANCE = betAmount; // Minimum balance must be at least the bet amount

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
          error: `Insufficient balance. Required: ${MIN_BALANCE} coins for this bet. Your balance: ${wallet.coins_balance}`,
          code: "INSUFFICIENT_BALANCE",
          balance: wallet.coins_balance,
          betAmount: betAmount,
          minRequired: MIN_BALANCE,
        }),
      );
      ws.close(1008, "Insufficient balance");
      return;
    }

    // Register user in this game
    const wsId = `pipshot_${userId}_${Date.now()}`;
    const registered = sessionManager.registerUser(userId, "pipshot", wsId);

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
    this.clients.set(userId, {
      userId,
      username,
      betAmount,
      ws,
      wallet,
    });

    // Add player to engine
    this.engine.addPlayer(userId, username, betAmount);

    ws.send(
      JSON.stringify({
        type: "welcome",
        playerId: userId,
        username: username,
        betAmount: betAmount,
        totalRounds: 5,
        wallet: {
          balance: wallet.coins_balance,
          usdt: wallet.usdt,
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
    const payload = JSON.stringify(message);
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
