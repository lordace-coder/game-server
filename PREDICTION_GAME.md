# Prediction Game

Admin-run prediction markets. An admin creates a market (a question with 2+
outcomes), users stake coins on an outcome, and the admin later **validates**
the market by choosing the winning outcome. The coins staked by losers are
pooled, the house takes an admin-defined percentage, and the remainder is
split among the winners pro-rata to their stake. Winners also get their own
stake back.

Coins are deducted from a user's wallet the moment they place a bet, so
settlement only ever *credits* the winners.

## Data model (CocoBase collections)

### `predictions`

| Field              | Type                                   | Notes                                   |
| ------------------ | -------------------------------------- | --------------------------------------- |
| `title`            | string                                 | The question                            |
| `description`      | string                                 | Optional context                        |
| `options`          | string[]                               | Outcome labels (min 2)                  |
| `house_percentage` | number                                 | House cut of the losers' pool (0–100)   |
| `status`           | `"open" \| "closed" \| "resolved"`     | open = accepting bets                   |
| `winning_option`   | number \| null                         | Index into `options` once resolved      |
| `closes_at`        | string \| null                         | Optional ISO betting deadline           |
| `created_by`       | string                                 | Admin user id                           |
| `created_at`       | string                                 | ISO timestamp                           |
| `resolved_at`      | string \| null                         | ISO timestamp                           |
| `house_collected`  | number                                 | Coins the house kept on resolution      |
| `total_pool`       | number                                 | Cached sum of all stakes                |

### `prediction_bets`

| Field           | Type                                          | Notes                          |
| --------------- | --------------------------------------------- | ------------------------------ |
| `prediction_id` | string                                        | Parent market                  |
| `user_id`       | string                                        | Bettor                         |
| `option_index`  | number                                        | Chosen outcome                 |
| `amount`        | number                                        | Coins staked                   |
| `status`        | `"active" \| "won" \| "lost" \| "refunded"`   | Set on resolution              |
| `payout`        | number                                        | Coins paid out (0 if lost)     |
| `created_at`    | string                                        | ISO timestamp                  |
| `settled_at`    | string \| null                                | ISO timestamp                  |

## Settlement math

```
totalPool     = sum(all stakes)
winnersStake  = sum(stakes on winning option)
losersPool    = totalPool - winnersStake
houseCut      = floor(losersPool * house_percentage / 100)
distributable = losersPool - houseCut

payout(winner) = stake + floor(distributable * stake / winnersStake)
payout(loser)  = 0
```

If **no one** picked the winning option, every stake is refunded and the house
takes nothing.

See `src/games/prediction/settlement.ts` for the pure implementation (shared
shape with the web client's `src/services/predictions.ts`).

## REST API

All responses are `{ ok: boolean, data?, error? }`.

| Method  | Path                       | Body                                                   | Purpose                     |
| ------- | -------------------------- | ------------------------------------------------------ | --------------------------- |
| `GET`   | `/predictions`             | — (optional `?status=open`)                            | List markets                |
| `POST`  | `/predictions`             | `{ title, options[], house_percentage, description?, closes_at?, created_by? }` | Create market (admin) |
| `GET`   | `/predictions/:id/bets`    | —                                                      | List bets for a market      |
| `POST`  | `/predictions/:id/bets`    | `{ user_id, option_index, amount }`                    | Place a bet                 |
| `PATCH` | `/predictions/:id`         | `{ status? , house_percentage? }`                      | Lock/reopen or set house %  |
| `POST`  | `/predictions/:id/resolve` | `{ winning_option }`                                   | Validate & pay out (admin)  |

> The web client (`agalio-games`) talks to CocoBase directly for the same
> collections, so the REST layer and the client stay schema-compatible. Either
> path can drive the game.
