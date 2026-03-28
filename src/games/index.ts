// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/index.ts
/**
 * Game Server - Multi-Game Router
 * Manages all game instances (Aviator, PipShot, etc.)
 */

import { WebSocket, WebSocketServer } from "ws";
import { AviatorHub } from "./aviator/hub";
import { PipShotHub } from "./pipshot/hub";

export class GameServer {
  private wss: WebSocketServer;
  private aviatorHub: AviatorHub;
  private pipShotHub: PipShotHub;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.aviatorHub = new AviatorHub(wss);
    this.pipShotHub = new PipShotHub(wss);

    console.log("[GameServer] Initialized with Aviator and PipShot games");
  }

  /**
   * Main WebSocket connection handler
   * Routes to appropriate game hub based on game_type query param
   */
  public handleConnection(ws: WebSocket, request: any) {
    try {
      const searchParams = new URL(request.url, `http://localhost`)
        .searchParams;
      const gameType = searchParams.get("game_type") || "aviator";

      console.log(`[GameServer] New connection: game_type=${gameType}`);

      switch (gameType) {
        case "aviator":
          this.aviatorHub.handleConnection(ws, request);
          break;
        case "pipshot":
          this.pipShotHub.handleConnection(ws, request);
          break;
        default:
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Unknown game_type: ${gameType}`,
            }),
          );
          ws.close();
      }
    } catch (error) {
      console.error(`[GameServer] Connection handler error: ${error}`);
      ws.close();
    }
  }

  /**
   * Shutdown all game servers
   */
  public shutdown() {
    console.log("[GameServer] Shutting down...");
    this.aviatorHub.shutdown();
    this.pipShotHub.shutdown();
  }
}

/**
 * Usage in main server file:
 *
 * import { GameServer } from './games';
 * import { WebSocketServer } from 'ws';
 *
 * const wss = new WebSocketServer({ port: 8080 });
 * const gameServer = new GameServer(wss);
 *
 * wss.on('connection', (ws, request) => {
 *   gameServer.handleConnection(ws, request);
 * });
 *
 * Process connection with query params:
 *   aviator: ws://localhost:8080?game_type=aviator&user_id=user123&room_id=aviator_main
 *   pipshot: ws://localhost:8080?game_type=pipshot&user_id=user123&room_id=pipshot_main&username=Player1&bet_amount=5
 */
