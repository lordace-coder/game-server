# Game Endpoints Documentation

## Quick Start

### Connection

Users automatically join when connecting to the WebSocket with proper query parameters:

```
ws://localhost:8080?user_id=user123&game_type=aviator
```

**Query Parameters:**

- `user_id` (required) - Unique user identifier
- `game_type` (optional, default: `aviator`) - `aviator` or `pipshot`
- `betAmount` (optional for PipShot, default: `5.0`) - Bet amount for PipShot game

**On successful connection**, you'll receive a welcome message:

```json
{
  "type": "welcome",
  "playerId": "user123",
  "wallet": {
    "balance": 100.5,
    "usdt": 50.25
  },
  "user": {
    "name": "Player Name",
    "picture": "https://...",
    "username": "player_name",
    "given_name": "Player",
    "family_name": "Name"
  },
  "state": {
    "status": "WAITING",
    "multiplier": 1.0
  }
}
```

---

## Aviator Game

**WebSocket Endpoint:** `ws://localhost:8080?user_id=<userId>&game_type=aviator`

### Automatic Connection

When you connect with the endpoint above, the server automatically verifies your wallet and joins you to the game. You'll receive a welcome message if successful.

### Actions

- **Stake** - Place a stake

  ```json
  {
    "action": "stake",
    "payload": { "amount": 10.0 }
  }
  ```

- **Cashout** - Cash out at current multiplier

  ```json
  {
    "action": "cashout",
    "payload": {}
  }
  ```

- **Cancel Stake** - Cancel pending stake
  ```json
  {
    "action": "cancel_stake",
    "payload": {}
  }
  ```

### Events (Received)

- `welcome` - Connected and joined successfully (includes user wallet and profile)
- `stake_success` - Stake placed
- `cashout_success` - Cashed out at multiplier
- `round_started` - Round begins
- `tick` - Multiplier update
- `crashed` - Round crashed
- `round_reset` - Ready for next round
- `error` - Error occurred (insufficient balance, already in game, etc.)

### Error Responses

```json
{
  "error": "Insufficient balance. Minimum required: 0.01 coins.",
  "code": "INSUFFICIENT_BALANCE",
  "balance": 0.005,
  "minRequired": 0.01
}
```

---

## PipShot Game

**WebSocket Endpoint:** `ws://localhost:8080?user_id=<userId>&game_type=pipshot&betAmount=<amount>`

### Automatic Connection

When you connect with the endpoint above, the server automatically verifies your wallet has at least the bet amount and joins you to the game. You'll receive a welcome message if successful.

### Query Parameters

- `user_id` (required) - Unique user identifier
- `game_type` (required) - Must be `pipshot`
- `betAmount` (optional, default: `5.0`) - Your bet amount for this game

### Actions

- **Lock Bet** - Commit to the bet

  ```json
  {
    "action": "lock_bet",
    "payload": {}
  }
  ```

- **Cancel Bet** - Cancel locked bet (only during WAITING phase)

  ```json
  {
    "action": "cancel_bet",
    "payload": {}
  }
  ```

- **Predict** - Submit prediction
  ```json
  {
    "action": "predict",
    "payload": { "direction": "up" }
  }
  ```

### Events (Received)

- `welcome` - Connected and joined successfully (includes user wallet and profile)
- `lock_bet_success` - Bet locked
- `cancel_bet_success` - Bet cancelled
- `predict_success` - Prediction submitted
- `game_started` - Game begins (all players ready)
- `round_streaming` - Chart is streaming
- `price_update` - Price tick update
- `predict_now` - Time to predict
- `round_result` - Round outcome
- `sudden_death` - Tiebreaker mode activated
- `game_ended` - Game finished with winner
- `round_reset` - Ready for next game
- `error` - Error occurred (insufficient balance, already in game, etc.)

### Error Responses

```json
{
  "error": "User already in aviator game. Leave that game first.",
  "code": "USER_ALREADY_IN_GAME"
}
```
