import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { GameServer } from "./games";
import { setupPredictionRoutes } from "./games/prediction/routes";
import "dotenv/config";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// JSON body parsing for REST endpoints
app.use(express.json());

// Basic CORS so the web client can call the prediction REST API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Initialize game server
const gameServer = new GameServer(wss);

// Attach WebSocket Hub - route to appropriate game
wss.on("connection", (ws, request) => {
  gameServer.handleConnection(ws, request);
});

// Prediction game REST endpoints
app.use("/predictions", setupPredictionRoutes());

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
