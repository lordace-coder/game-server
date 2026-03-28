# Integration Guide

## File Structure

```
src/games/
├── aviator/
│   ├── engine.ts       - Game logic
│   └── hub.ts          - WebSocket handler
├── pipshot/
│   ├── engine-clean.ts - Game logic (use this, delete engine.ts)
│   └── hub.ts          - WebSocket handler
└── routes.ts           - Endpoint router
```

## Setup in Main Server

### 1. Import routes

```typescript
import { setupGameRoutes } from "./games/routes";
```

### 2. Register endpoints

```typescript
const { aviatorHub, pipShotHub } = setupGameRoutes(app, wss);
```

### 3. Each game has separate WebSocket endpoint

- Aviator: `ws://localhost:8080/game/aviator`
- PipShot: `ws://localhost:8080/game/pipshot`

## Key Differences

| Feature         | Aviator            | PipShot                    |
| --------------- | ------------------ | -------------------------- |
| **Round Time**  | ~30s (variable)    | ~10-15s per round          |
| **Players**     | Unlimited          | 2-50 per game              |
| **Rounds**      | Infinite           | 5 rounds (or sudden death) |
| **Interaction** | Cashout timing     | Predict direction          |
| **Payout**      | Multiplier x stake | Prize pool split           |
| **House Edge**  | 1% on crashes      | 1% of pot                  |

## TODO Items for Queue Integration

### Aviator Engine

- Line 298: `queue.add("write_wallet_task", ...)`
- Line 301: `queue.add("credit_admin_task", ...)`
- Line 304: `queue.add("save_history_task", ...)`

### PipShot Engine

- Line 575: `queue.add(...)` for winner payout
- Line 576: `queue.add(...)` for house cut
- Line 577: `queue.add(...)` for game history

## Database Tasks to Implement

### Aviator

1. `write_wallet_task` - Update player wallets after crash
2. `credit_admin_task` - Add house cut to admin
3. `save_history_task` - Record round history

### PipShot

1. `process_winner_payout` - Pay winner from pot
2. `process_house_cut` - Credit admin with fee
3. `save_game_history` - Record game session
4. `process_bet_refund` - Refund disconnected player

All tasks use `queue.add()` for fire-and-forget non-blocking execution.
