import { Router } from "express";
import { Server as WSServer } from "ws";
import { AviatorHub } from "./aviator/hub";
import { PipShotHub } from "./pipshot/hub";

export function setupGameRoutes(app: Router, wss: WSServer) {
  // Initialize game hubs
  const aviatorWSS = new WSServer({ noServer: true });
  const pipShotWSS = new WSServer({ noServer: true });

  const aviatorHub = new AviatorHub(aviatorWSS);
  const pipShotHub = new PipShotHub(pipShotWSS);

  // Aviator endpoint: ws://localhost:8080/game/aviator
  app.get("/game/aviator", (req, res) => {
    wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
      
      aviatorWSS.emit("connection", ws, req);
    });
  });

  // PipShot endpoint: ws://localhost:8080/game/pipshot
  app.get("/game/pipshot", (req, res) => {
    wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
      pipShotWSS.emit("connection", ws, req);
    });
  });

  return { aviatorHub, pipShotHub };
}
