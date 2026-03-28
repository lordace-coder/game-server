# Game Endpoints Documentation

## Aviator Game

**WebSocket Endpoint:** `ws://localhost:8080/game/aviator`

### Connection

```json
{
  "type": "join",
  "userId": "user123"
}
```

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

- `stake_success` - Stake placed
- `cashout_success` - Cashed out at multiplier
- `round_started` - Round begins
- `tick` - Multiplier update
- `crashed` - Round crashed
- `round_reset` - Ready for next round

---

## PipShot Game

**WebSocket Endpoint:** `ws://localhost:8080/game/pipshot`

### Connection

```json
{
  "type": "join",
  "userId": "user123",
  "username": "PlayerName",
  "betAmount": 5.0
}
```

### Actions

- **Lock Bet** - Commit to the bet

  ```json
  {
    "action": "lock_bet",
    "payload": {}
  }
  ```

- **Cancel Bet** - Cancel locked bet (only during WAITING)

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

---

## Game States & Flow

### Aviator Flow

```
WAITING → [min players & countdown] → RUNNING → [multiplier increases] → CRASH → ENDED → WAITING
```

### PipShot Flow

```
WAITING → [min players & countdown] → STARTING → STREAMING → PREDICTING → REVEALING → [check winner] → WAITING
```
