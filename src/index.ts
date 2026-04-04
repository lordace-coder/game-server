import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { GameServer } from "./games";
import "dotenv/config";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize game server
const gameServer = new GameServer(wss);

// Attach WebSocket Hub - route to appropriate game
wss.on("connection", (ws, request) => {
  gameServer.handleConnection(ws, request);
});

// Standard HTTP health check
app.get("/health", (req, res) => res.send("Server OK"));

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
  console.log(`🚀 Multi-Game Server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  gameServer.shutdown();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
