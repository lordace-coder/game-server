import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleSocketConnection } from './sockets/hub';
import 'dotenv/config';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Attach WebSocket Hub
wss.on('connection', (ws) => handleSocketConnection(ws));

// Standard HTTP health check
app.get('/health', (req, res) => res.send('Server OK'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Multi-Game Server running on port ${PORT}`);
});