# Integration Guide

## Overview

The game server is a multi-game WebSocket server that automatically validates users and joins them to games on connection. No separate join message is needed.

## Architecture

```
GameServer (handles routing)
├── AviatorHub (manages Aviator instances)
│   ├── AviatorEngine (game logic & events)
│   └── ClientSession[] (player state)
└── PipShotHub (manages PipShot instances)
    ├── PipShotEngine (game logic & events)
    └── ClientSession[] (player state)
```

## Connection Flow

1. **Client connects** with `ws://localhost:8080?user_id=<id>&game_type=<game>&...`
2. **GameServer** extracts query parameters and routes to appropriate hub
3. **Hub automatically joins** the user by:
   - Fetching wallet from Cocobase database
   - Validating minimum balance requirement
   - Checking SessionManager to prevent multi-game joins
   - Registering user session
4. **Server sends welcome** message with user data and game state
5. **Client sends game actions** (stake, cashout, predict, etc.)

## Setup in Main Server

### 1. Import GameServer

```typescript
import { GameServer } from "./games";
```

### 2. Create WebSocket server and initialize GameServer

```typescript
import { WebSocketServer } from "ws";
import { GameServer } from "./games";

const wss = new WebSocketServer({ port: 8080 });
const gameServer = new GameServer(wss);

wss.on("connection", (ws, request) => {
  gameServer.handleConnection(ws, request);
});
```

## Query Parameters (Required & Optional)

| Parameter   | Required          | Default | Description                          |
| ----------- | ----------------- | ------- | ------------------------------------ |
| `user_id`   | ✅                | -       | Unique user identifier               |
| `game_type` | ❌                | aviator | Game to join: `aviator` or `pipshot` |
| `betAmount` | ❌ (PipShot only) | 5.0     | Bet amount for PipShot game          |

## Connection Examples

### Aviator

```
ws://localhost:8080?user_id=user123&game_type=aviator
```

### PipShot (with custom bet)

```
ws://localhost:8080?user_id=user456&game_type=pipshot&betAmount=10.5
```

## Game-Specific Details

### Aviator

| Feature         | Details                                                  |
| --------------- | -------------------------------------------------------- |
| **Min Balance** | 0.01 coins                                               |
| **Max Players** | Unlimited                                                |
| **Round Time**  | ~30s (variable, ends on crash)                           |
| **Interaction** | Place stake → Wait for multiplier → Cashout before crash |
| **Payout**      | Stake × Multiplier - 1% house edge                       |

**Actions:**

- `stake` → Locks coins until cashout or crash
- `cashout` → Instant payout at current multiplier
- `cancel_stake` → Cancels pending stake

### PipShot

| Feature         | Details                                             |
| --------------- | --------------------------------------------------- |
| **Min Balance** | Bet amount (default 5.0 coins)                      |
| **Max Players** | 2-50 per game                                       |
| **Round Time**  | 10-15s per round, 5 rounds per game                 |
| **Interaction** | Lock bet → Predict direction → Reveal → Winner paid |
| **Payout**      | Prize pool split among winners - 1% house fee       |

**Actions:**

- `lock_bet` → Commits the bet amount
- `cancel_bet` → Cancels (only in WAITING phase)
- `predict` → Direction prediction (up/down)

## Key Classes

### GameServer (`src/games/index.ts`)

```typescript
class GameServer {
  handleConnection(ws: WebSocket, request: any): void;
  shutdown(): void;
}
```

**Responsibility:** Routes WebSocket connections to appropriate game hub based on `game_type` query parameter.

### AviatorHub & PipShotHub (`src/games/{game}/hub.ts`)

```typescript
class AviatorHub {
  handleConnection(ws: WebSocket, request: any, userId: string): void;
  handleJoin(ws: WebSocket, message: any): Promise<void>;
  handleDisconnect(ws: WebSocket): void;
  shutdown(): void;
}
```

**Responsibility:**

- Auto-joins user on connection
- Manages player sessions
- Routes game actions to engine
- Broadcasts game state to all players

### Wallet Integration (`src/core/cocobase.ts`)

```typescript
class CocobaseHelper {
  static async getWallet(userId: string): Promise<Wallet>;
  static async syncWallet(userId: string, amount: number): Promise<void>;
  static async getBalance(userId: string): Promise<number>;
}
```

**Wallet Structure:**

```json
{
  "coins_balance": 100.5,
  "usdt": 50.25,
  "user_id": "user123",
  "user": {
    "name": "Player Name",
    "picture": "https://...",
    "username": "player_name",
    "given_name": "Player",
    "family_name": "Name"
  }
}
```

The `user` field is populated from the Cocobase database using `populate: ["user"]`.

### Session Manager (`src/utils/sessionManager.ts`)

```typescript
class SessionManager {
  registerUser(userId: string, gameType: string, wsId: string): boolean;
  unregisterUser(userId: string): void;
  isUserInGame(userId: string): boolean;
  getAllSessions(): UserSession[];
}
```

**Purpose:** Prevents users from joining multiple games simultaneously. Returns error with code `USER_ALREADY_IN_GAME` if user tries to join while already in a game.

## Error Handling

### Insufficient Balance

```json
{
  "error": "Insufficient balance. Minimum required: 0.01 coins.",
  "code": "INSUFFICIENT_BALANCE",
  "balance": 0.005,
  "minRequired": 0.01
}
```

Server closes connection with code `1008`.

### User Already in Game

```json
{
  "error": "User already in aviator game. Leave that game first.",
  "code": "USER_ALREADY_IN_GAME"
}
```

Server closes connection with code `1008`.

### Wallet Not Found

```json
{
  "error": "Wallet not found",
  "code": "WALLET_NOT_FOUND"
}
```

Server closes connection with code `1008`.

## Broadcast Messages

All broadcasts include enriched player data:

```json
{
  "type": "round_started",
  "playerId": "user123",
  "player": {
    "userId": "user123",
    "username": "Player Name",
    "wallet": {
      "balance": 99.50,
      "usdt": 50.25
    },
    "user": {
      "name": "Player Name",
      "picture": "https://...",
      "username": "player_name",
      "given_name": "Player",
      "family_name": "Name"
    }
  },
  ...otherData
}
```

## Game States & Flow

### Aviator Flow

```
WAITING → [min players & countdown] → RUNNING → [multiplier increases] → CRASH → ENDED → WAITING
```

### PipShot Flow

```
WAITING → [min players & countdown] → STARTING → STREAMING → PREDICTING → REVEALING → [check winner] → WAITING
```

## File Structure

```
src/games/
├── index.ts                      - GameServer class (router)
├── aviator/
│   ├── engine.ts                 - AviatorEngine logic
│   ├── hub.ts                    - AviatorHub socket handler
│   ├── constants.ts              - Game constants
│   └── cocobase-tasks.ts         - Database queue tasks
├── pipshot/
│   ├── engine.ts                 - PipShotEngine logic
│   ├── engine-clean.ts           - Cleaned version (use this)
│   ├── hub.ts                    - PipShotHub socket handler
│   ├── constants.ts              - Game constants
│   └── cocobase-tasks.ts         - Database queue tasks
├── core/
│   └── cocobase.ts               - Database abstraction
├── utils/
│   └── sessionManager.ts         - Multi-game prevention
└── types/
    ├── documents.ts              - Wallet, UserData interfaces
    └── index.ts                  - General types
```

## Environment Variables

```env
COCOBASE_API_KEY=your_api_key
COCOBASE_PROJECT_ID=your_project_id
COCOBASE_URL=https://api.cocobase.com
PORT=8080
```

## TODO: Queue Integration

The following files have TODO items for integrating with a job queue system (Bull Queue, etc.) for async wallet updates:

### Aviator (`src/games/aviator/engine.ts`)

- Line 298: `queue.add("write_wallet_task", ...)`
- Line 301: `queue.add("credit_admin_task", ...)`
- Line 304: `queue.add("save_history_task", ...)`

### PipShot (`src/games/pipshot/engine.ts`)

- Line 575: `queue.add(...)` for winner payout
- Line 576: `queue.add(...)` for house cut
- Line 577: `queue.add(...)` for game history

## Testing

Use `test-game.html` in the project root for WebSocket testing:

1. Enter User IDs for players
2. Select game type
3. Click Connect (automatically joins)
4. Send JSON messages from textarea (e.g., `{"action":"stake","payload":{"amount":10}}`)
5. Filter logs by message type or keyword
