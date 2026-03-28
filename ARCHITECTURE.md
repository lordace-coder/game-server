# Game Server Architecture - Cleaned Up

## File Organization

### Core Entry Point

- **`src/index.ts`** - Main server file
  - Creates Express HTTP server
  - Creates WebSocketServer
  - Initializes GameServer (single instance)
  - Routes all connections through GameServer.handleConnection()

### Game Server Router

- **`src/games/index.ts`** - GameServer class
  - Single point of connection routing
  - Routes to appropriate hub based on `game_type` query param
  - Manages shutdown of all hubs

### Game Hubs (Per-Game Managers)

- **`src/games/aviator/hub.ts`** - AviatorHub
  - Manages Aviator game state and players
  - Does NOT set up its own connection listeners (GameServer does this)
  - Calls handleConnection() for each new connection

- **`src/games/pipshot/hub.ts`** - PipShotHub
  - Manages PipShot game state and players
  - Does NOT set up its own connection listeners (GameServer does this)
  - Calls handleConnection() for each new connection

### Session Management

- **`src/utils/sessionManager.ts`** - Global session manager (Singleton)
  - Prevents users from being in multiple games simultaneously
  - Tracks active sessions across ALL games
  - Called by both hubs during join/disconnect

## Connection Flow

```
Client WebSocket Connection
    ↓
src/index.ts (wss.on('connection'))
    ↓
GameServer.handleConnection(ws, request)
    ↓
Extract game_type from URL query params
    ↓
Route to appropriate hub:
  - AviatorHub.handleConnection() OR
  - PipShotHub.handleConnection()
    ↓
Hub sets up message/close listeners
    ↓
On message: hub calls handleMessage()
    ↓
If join: call sessionManager checks + hub adds player
    ↓
On close: call sessionManager.unregisterUser()
```

## Files to DELETE (Old/Unused)

- ❌ `src/sockets/hub.ts` - Old connection handler (replaced by GameServer)
- ❌ `src/games/routes.ts` - Old routing (replaced by GameServer)

## Session Manager Flow

```
Player tries to join Aviator:
  1. Hub calls sessionManager.isUserInGame(userId)
  2. If already in game → reject with error + close connection
  3. If free → call sessionManager.registerUser(userId, "aviator", wsId)
  4. Hub stores session locally
  5. Hub adds player to engine

Player disconnects:
  1. Hub's close listener fires
  2. Hub calls sessionManager.unregisterUser(userId)
  3. Hub removes player from engine
  4. Hub removes from local clients map
```

## Key Improvements

✅ Single connection entry point (no duplicate listeners)
✅ Global session tracking prevents multi-game joins
✅ Clean separation of concerns
✅ Centralized routing logic
✅ Proper shutdown handling
