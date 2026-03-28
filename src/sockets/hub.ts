import { WebSocket } from "ws";
import { AviatorEngine } from "../games/aviator/engine";

// Initialize Game Engines
const aviator = new AviatorEngine();
// const mines = new MinesEngine();

export function handleSocketConnection(ws: WebSocket) {
  console.log("New Player Connected");

  ws.on("message", async (raw: string) => {
    try {
      const data = JSON.parse(raw);
      const { gameId, action, userId } = data;

      // ROUTING LOGIC
      switch (gameId) {
        case "aviator":
          await aviator.handleAction(ws, action, userId, data.payload);
          break;
        case "mines":
          // mines.handleAction(ws, action, userId, data.payload);
          break;
        default:
          ws.send(JSON.stringify({ error: "Unknown Game ID" }));
      }
    } catch (err) {
      console.error("Socket Message Error", err);
    }
  });

  ws.on("close", () => console.log("Player Disconnected"));
}

// Global Broadcast helper (used by engines)
export function broadcastToAll(wss: any, message: any) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}
