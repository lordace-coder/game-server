# Game Server Architecture

## Overview

This is a multi-game WebSocket server with automatic user validation and join. Users connect with query parameters and are automatically joined to the game without needing an explicit join message.

## Connection Flow

```
1. Client connects: ws://localhost:8080?user_id=user123&game_type=aviator
                                       ↓
2. src/index.ts receives connection
                                       ↓
3. GameServer.handleConnection(ws, request)
   - Extracts user_id and game_type from query params
   - Validates user_id exists
                                       ↓
4. Route to appropriate hub (AviatorHub or PipShotHub)
   - hub.handleConnection(ws, request, userId)
                                       ↓
5. Hub automatically calls handleJoin(ws, {userId})
   - Fetches wallet from Cocobase
   - Validates minimum balance
   - Checks SessionManager (prevents multi-game joins)
   - Registers user session
                                       ↓
6. Server sends "welcome" message with user data
   OR
   Server sends error and closes connection
                                       ↓
7. Client now ready to send game actions
```

## File Organization

### Core Entry Point

- **`src/index.ts`** - Main server file
  - Creates Express HTTP server on configured PORT
  - Creates WebSocketServer
  - Initializes GameServer (single instance)
  - Routes ALL WebSocket connections through `gameServer.handleConnection()`
  - Loads environment variables from `.env` file

### Game Server Router

- **`src/games/index.ts`** - GameServer class
  - Single routing gateway for all connections
  - Extracts query parameters: `user_id` (required), `game_type` (optional), `betAmount` (optional)
  - Routes to appropriate hub based on `game_type`:
    - `aviator` → AviatorHub.handleConnection()
    - `pipshot` → PipShotHub.handleConnection()
  - Validates `user_id` parameter exists
  - Manages lifecycle of all game hubs
  - Handles errors and closes invalid connections

### Game Hubs (Per-Game Managers)

#### AviatorHub (`src/games/aviator/hub.ts`)

- **Responsibilities:**
  - Auto-joins users on connection (no join message needed)
  - Manages Aviator game state and round loops
  - Maintains player session state
  - Routes game actions to AviatorEngine
  - Broadcasts game state to all connected players

- **Key Methods:**
  - `handleConnection(ws, request, userId)` - Auto-joins user
  - `handleMessage(ws, data)` - Processes game actions (stake, cashout, etc.)
  - `handleJoin(ws, message)` - Validates wallet and registers session
  - `handleDisconnect(ws)` - Cleans up session on disconnect
  - `broadcastToAll(message)` - Enriches and broadcasts to all players

- **Session State:**
  - `ClientSession { userId, ws, wallet }`
  - Wallet includes balance, usdt, and user profile data

#### PipShotHub (`src/games/pipshot/hub.ts`)

- **Responsibilities:**
  - Auto-joins users on connection (no join message needed)
  - Manages PipShot game state and rounds (max 5 per game)
  - Maintains player session state with bet tracking
  - Routes game actions to PipShotEngine
  - Broadcasts game state and price updates

- **Key Methods:**
  - `handleConnection(ws, request, userId)` - Auto-joins user
  - `handleMessage(ws, data)` - Processes game actions (lock_bet, predict, etc.)
  - `handleJoin(ws, message)` - Validates wallet for bet amount
  - `handleDisconnect(ws)` - Cleans up session on disconnect
  - `broadcastToAll(message)` - Enriches and broadcasts to all players

- **Session State:**
  - `ClientSession { userId, username, betAmount, ws, wallet }`

### Game Engines (Game Logic)

- **`src/games/aviator/engine.ts`** - AviatorEngine
  - Implements Aviator game mechanics (crash multiplier)
  - Emits events: `broadcast`, `stake_success`, `cashout_success`, `crashed`, etc.
  - Runs on 20Hz tick loop (50ms intervals)
  - Handles multiplier calculation and crash detection

- **`src/games/pipshot/engine.ts`** - PipShotEngine
  - Implements PipShot game mechanics (price prediction)
  - Emits events: `broadcast`, `game_started`, `round_streaming`, `price_update`, etc.
  - Runs on tick loop
  - Handles price streaming, outcome calculation, and winner detection

### Database & Wallet Management

- **`src/core/cocobase.ts`** - CocobaseHelper (static methods)
  - `getWallet(userId)` - Fetches wallet with populated user data
    - Uses `populate: ["user"]` to include user profile
    - Returns: `{ coins_balance, usdt, user_id, user }`
  - `getBalance(userId)` - Quick balance check
  - `syncWallet(userId, amount)` - Update balance after game outcome
  - Uses environment variables: `COCOBASE_API_KEY`, `COCOBASE_PROJECT_ID`, `COCOBASE_URL`

- **`src/types/documents.ts`** - Type definitions
  - `Wallet` - Database wallet document structure
  - `UserData` - User profile from populated wallet
  - Ensures type safety across codebase

### Session Management

- **`src/utils/sessionManager.ts`** - SessionManager (Singleton)
  - **Purpose:** Prevent users from joining multiple games simultaneously
  - **Key Methods:**
    - `registerUser(userId, gameType, wsId)` - Returns true if registered, false if already in game
    - `unregisterUser(userId)` - Remove from tracking on disconnect
    - `isUserInGame(userId)` - Check if user has active session
    - `getUserSession(userId)` - Get current session details
    - `getAllSessions()` - Debug: list all active sessions
  - **Global State:** Maintains `Map<userId, UserSession>`
  - **Error Response:** `USER_ALREADY_IN_GAME` with game type info

### Game-Specific Constants

- **`src/games/aviator/constants.ts`**
  - Aviator game configuration (min players, multiplier ranges, etc.)

- **`src/games/pipshot/constants.ts`**
  - PipShot game configuration (round count, price range, etc.)

### Queue/Task Integration (TODO)

- **`src/games/aviator/cocobase-tasks.ts`** - Async wallet update tasks for Aviator
- **`src/games/pipshot/cocobase-tasks.ts`** - Async wallet update tasks for PipShot
- Currently TODO: Integrate with job queue system (Bull Queue, etc.)

## Message Flow

### Client → Server

**Format:** JSON object with `action` field and optional `payload`

```json
{
  "action": "stake",
  "payload": { "amount": 10.0 }
}
```

### Server → Client

**Broadcast Format:** JSON with enriched player data

```json
{
  "type": "round_started",
  "playerId": "user123",
  "player": {
    "userId": "user123",
    "wallet": { "balance": 99.50, "usdt": 50.25 },
    "user": { "name": "...", "username": "...", ... }
  },
  ...otherFields
}
```

## Error Handling

### Connection Errors

1. **Missing user_id parameter**
   - Close connection immediately
   - Send error message

2. **Wallet not found**
   - Close with code `1008`
   - Send error: `WALLET_NOT_FOUND`

3. **Insufficient balance**
   - Close with code `1008`
   - Send error: `INSUFFICIENT_BALANCE` with balance details

4. **User already in game**
   - Close with code `1008`
   - Send error: `USER_ALREADY_IN_GAME` with current game type

### During Game

- Invalid action → Send error message, keep connection open
- Disconnection → Clean up session, unregister from SessionManager
- Network error → Automatic reconnect (client responsibility)

## Environment Configuration

**`.env` file:**

```env
COCOBASE_API_KEY=your_api_key
COCOBASE_PROJECT_ID=your_project_id
COCOBASE_URL=https://api.cocobase.com
PORT=8080
```

## Wallet Validation Rules

### Aviator

- **Minimum:** 0.01 coins
- **Stake Requirement:** Have at least `amount` coins available
- **Deduction:** Happens on stake confirmation

### PipShot

- **Minimum:** Equal to bet amount
- **Bet Requirement:** Have at least `betAmount` coins
- **Deduction:** Happens on lock_bet

## Broadcasting

Both hubs enrich game messages before broadcasting to ensure all players have access to full player data:

```javascript
enrichedMessage.player = {
  userId: session.userId,
  wallet: { balance, usdt },
  user: { name, picture, username, ... }
};
```

This allows frontend to display player profiles, balances, and update UI based on other players' actions.

## Testing

**`test-game.html`** - Browser-based WebSocket test client

Features:

- Dual-player testing interface
- Automatic connection with query parameters
- Free-form JSON message input (send any game action)
- Log filtering by message type or keyword
- Clear logs button
- Keyboard shortcut: Ctrl+Enter to send

Usage:

1. Enter user IDs for both players
2. Select game type (Aviator or PipShot)
3. Click Connect (server auto-joins)
4. Send JSON game actions from textarea
5. Filter logs to debug specific scenarios

## Scalability Considerations

1. **Per-Hub Instances:** Each game type has one engine shared by all players
2. **Session Tracking:** SessionManager uses Map for O(1) lookup
3. **Broadcasting:** Linear to connected players, no broadcast optimization
4. **Tick Loop:** Fixed 20Hz rate, can be tuned per game
5. **Database:** All wallet operations are async to prevent blocking

## Future Enhancements

1. **Job Queue Integration** - Move wallet updates to background jobs
2. **Game History** - Store outcomes in database
3. **Leaderboards** - Track player stats and rankings
4. **Rate Limiting** - Prevent action spam
5. **Reconnection Logic** - Auto-rejoin on network failure
6. **Multiple Hubs** - Scale to multiple engine instances per game

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
```
