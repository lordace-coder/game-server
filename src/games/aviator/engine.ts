import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { CocobaseHelper } from "../../core/cocobase";

// ============================================================
// CONSTANTS
// ============================================================
const MULTIPLIER_INCREMENT = 0.01;
const MIN_MULTIPLIER = 1.0;

const MIN_PLAYERS_TO_START = 2;
const WAITING_TIME_READY = 500;
const WAITING_TIME_NO_STAKES = 250;
const ENDED_WAITING_TIME = 150;

// ── House & prize pool config ────────────────────────────────
// House takes this % of the total pot every round, always
const HOUSE_EDGE = 0.03; // 3%

// How the prize pool is weighted between the two scoring factors
const WEIGHT_STAKE = 0.5;     // 50% — proportional to stake vs total pot
const WEIGHT_RISK = 0.5;      // 50% — proportional to proximity to crash

// ============================================================
// TYPES
// ============================================================
interface PlayerState {
  stake: number;
  cashedOut: boolean;
  cashoutMultiplier: number | null;
  intendedPayout: number;  // unused in new model, kept for interface compat
  actualPayout: number;    // final payout from prize pool (winners only)
  surplusShare: number;    // unused in new model, kept for interface compat
  connected: boolean;
}

interface WalletCacheEntry {
  id: string;
  balance: number;
}

interface RoundResult {
  [playerId: string]: {
    stake: number;
    cashedOut: boolean;
    cashoutMultiplier?: number;
    payout: number;
    surplusShare: number;
    totalReturn: number;
    profit: number;
  };
}

export class AviatorEngine extends EventEmitter {
  public status: "WAITING" | "RUNNING" | "ENDED" = "WAITING";
  public multiplier: number = 1.0;
  private interval: NodeJS.Timeout | null = null;

  // Round state
  private roundId: string = "";
  private serverSeed: string = "";
  private crashMultiplier: number | null = null;
  private tick: number = 0;
  private waitingTicks: number = WAITING_TIME_NO_STAKES;
  private totalStaked: number = 0;
  private starting: boolean = false;
  private readyToStart: boolean = false;

  // Memory cache
  private players: Map<string, PlayerState> = new Map();
  private walletCache: Map<string, WalletCacheEntry> = new Map();

  constructor() {
    super();
    this.roundId = this.generateRoundId();
    this.serverSeed = Math.random().toString();
  }

  // ============================================================
  // MAIN ACTION HANDLER
  // ============================================================
  public async handleAction(
    ws: WebSocket,
    action: string,
    userId: string,
    payload: any,
  ) {
    switch (action) {
      case "stake":
        await this.handleStake(ws, userId, payload.amount);
        break;
      case "cashout":
        this.handleCashout(ws, userId);
        break;
      case "cancel_stake":
        this.handleCancelStake(ws, userId);
        break;
      default:
        ws.send(JSON.stringify({ error: "Invalid Aviator Action" }));
    }
  }

  // ============================================================
  // TICK LOOP
  // ============================================================
  public async onTick() {
    if (this.status === "WAITING") {
      const playersWithStakes = Array.from(this.players.values()).filter(
        (p) => p.stake > 0,
      ).length;

      if (this.waitingTicks <= 0) {
        if (playersWithStakes >= MIN_PLAYERS_TO_START && !this.starting) {
          this.starting = true;
          this.startRound();
          return;
        }
        if (playersWithStakes < MIN_PLAYERS_TO_START) {
          this.waitingTicks = WAITING_TIME_NO_STAKES;
          this.readyToStart = false;
        }
        return;
      }

      this.waitingTicks -= 1;

      if (this.waitingTicks % 50 === 0) {
        this.emit("broadcast", {
          type: "waiting",
          secondsLeft: this.waitingTicks / 50,
          playersStaked: playersWithStakes,
        });
      }
      return;
    }

    if (this.status === "ENDED") {
      if (this.waitingTicks <= 0) {
        this.resetRound();
      } else {
        this.waitingTicks -= 1;
        if (this.waitingTicks % 30 === 0) {
          this.emit("broadcast", {
            type: "round_ending",
            secondsLeft: this.waitingTicks / 50,
          });
        }
      }
    }
  }

  // ============================================================
  // DISCONNECT HANDLER
  // ============================================================
  public async handleDisconnect(userId: string) {
    const player = this.players.get(userId);
    if (!player) return;

    if (this.status === "WAITING" && player.stake > 0) {
      const refund = player.stake;
      player.stake = 0;
      this.totalStaked -= refund;

      const cacheEntry = this.walletCache.get(userId);
      if (cacheEntry) {
        cacheEntry.balance += refund;
        CocobaseHelper.syncWallet(userId, refund).catch((e) =>
          console.error(`[Aviator] Failed to sync refund for ${userId}:`, e),
        );
      }
    }

    player.connected = false;
    this.emit("broadcast", { type: "player_left", playerId: userId });
  }

  // ============================================================
  // STAKE
  // ============================================================
  private async handleStake(ws: WebSocket, userId: string, amount: number) {
    if (this.status !== "WAITING")
      return ws.send(JSON.stringify({ error: "Round started" }));

    if (amount <= 0)
      return ws.send(JSON.stringify({ error: "Invalid stake amount" }));

    let cacheEntry = this.walletCache.get(userId);
    if (!cacheEntry) {
      const balance = await CocobaseHelper.getBalance(userId);
      cacheEntry = { id: userId, balance };
      this.walletCache.set(userId, cacheEntry);
    }

    if (cacheEntry.balance < amount)
      return ws.send(JSON.stringify({ error: "Insufficient balance" }));

    const oldStake = this.players.get(userId)?.stake || 0;
    cacheEntry.balance -= amount;
    this.totalStaked = this.totalStaked - oldStake + amount;

    this.players.set(userId, {
      stake: amount,
      cashedOut: false,
      cashoutMultiplier: null,
      intendedPayout: 0,
      actualPayout: 0,
      surplusShare: 0,
      connected: true,
    });

    ws.send(
      JSON.stringify({
        type: "stake_success",
        newBalance: cacheEntry.balance,
        stake: amount,
      }),
    );

    this.emit("broadcast", {
      type: "player_staked",
      playerId: userId,
      amount,
      totalPot: this.totalStaked,
    });

    const playersWithStakes = Array.from(this.players.values()).filter(
      (p) => p.stake > 0,
    ).length;

    if (
      playersWithStakes >= MIN_PLAYERS_TO_START &&
      !this.readyToStart &&
      this.status === "WAITING"
    ) {
      this.readyToStart = true;
      this.waitingTicks = WAITING_TIME_READY;
    }
  }

  // ============================================================
  // CASHOUT — records intent only, wallet settled at crash time
  // ============================================================
  private handleCashout(ws: WebSocket, userId: string) {
    const player = this.players.get(userId);

    if (this.status !== "RUNNING" || !player || player.cashedOut)
      return ws.send(JSON.stringify({ error: "Cannot cashout right now" }));

    player.cashedOut = true;
    player.cashoutMultiplier = this.multiplier;
    // intendedPayout = stake only (multiplier no longer drives payout)
    player.intendedPayout = player.stake;

    ws.send(
      JSON.stringify({
        type: "cashout_pending",
        lockedMultiplier: this.multiplier,
        intendedPayout: player.intendedPayout,
      }),
    );

    this.emit("broadcast", {
      type: "player_cashed_out",
      playerId: userId,
      multiplier: this.multiplier,
    });
  }

  // ============================================================
  // CANCEL STAKE
  // ============================================================
  private handleCancelStake(ws: WebSocket, userId: string) {
    if (this.status !== "WAITING")
      return ws.send(
        JSON.stringify({ error: "Cannot cancel during active round" }),
      );

    const player = this.players.get(userId);
    if (!player || player.stake <= 0)
      return ws.send(JSON.stringify({ error: "No active stake" }));

    const cancelled = player.stake;
    player.stake = 0;
    this.totalStaked -= cancelled;

    const cacheEntry = this.walletCache.get(userId);
    if (cacheEntry) cacheEntry.balance += cancelled;

    ws.send(
      JSON.stringify({
        type: "cancel_stake_success",
        refunded: cancelled,
        balance: cacheEntry?.balance || 0,
      }),
    );

    this.emit("broadcast", {
      type: "stake_cancelled",
      playerId: userId,
      totalPot: this.totalStaked,
    });
  }

  // ============================================================
  // START ROUND
  // ============================================================
  private startRound() {
    this.status = "RUNNING";
    this.roundId = this.generateRoundId();
    this.serverSeed = Math.random().toString();
    this.crashMultiplier = this.generateCrashPoint();
    this.multiplier = 1.0;
    this.tick = 0;

    this.emit("broadcast", {
      type: "round_started",
      roundId: this.roundId,
      totalPot: this.totalStaked,
    });

    this.interval = setInterval(() => {
      this.tick++;
      this.multiplier =
        Math.round((MIN_MULTIPLIER + this.tick * MULTIPLIER_INCREMENT) * 100) /
        100;

      this.emit("broadcast", { type: "tick", multiplier: this.multiplier });

      if (this.crashMultiplier && this.multiplier >= this.crashMultiplier) {
        this.crash();
      }
    }, 50);
  }

  // ============================================================
  // CRASH — full pot redistribution by proximity + stake score
  // ============================================================
  //
  // Reward model:
  //   - House takes HOUSE_EDGE (3%) of the total pot, always
  //   - Remaining prize pool is split entirely among WINNERS only
  //   - Losers (held through crash) get nothing
  //   - Each winner's share is weighted by:
  //
  //       STAKE SCORE (50%)
  //         = player.stake / totalPot
  //         Bigger bets vs the whole pot earn a bigger base share
  //
  //       PROXIMITY SCORE (50%)
  //         = (1 / gap) normalised across all winners
  //         gap = crashMultiplier − cashoutMultiplier
  //         Smaller gap = cashed out closer to crash = higher score
  //         Gap floored at 0.001 to avoid division by zero
  //
  //   Example: pot=20, crash=3.0x, house=0.6, prizePool=19.4
  //     Player A: stake=10, cashout=1.0x → gap=2.0, proximity=0.50
  //     Player B: stake=10, cashout=2.0x → gap=1.0, proximity=1.00
  //     Proximity normalised: A=0.333, B=0.667
  //     Stake scores (equal): A=0.5, B=0.5
  //     Final scores: A=0.417, B=0.583
  //     Payouts: A≈8.09 coins, B≈11.31 coins
  //     → B earns more for holding longer, A loses some stake for leaving early
  //
  private crash() {
    if (this.interval) clearInterval(this.interval);
    this.status = "ENDED";

    const crashedAt = this.multiplier;
    this.emit("broadcast", { type: "crashed", multiplier: crashedAt });

    const pot = this.totalStaked;

    // ── Step 1: Separate winners from losers ─────────────────────────────────
    const winners: Array<{ playerId: string; player: PlayerState }> = [];
    const losers: Array<{ playerId: string; player: PlayerState }> = [];

    for (const [playerId, player] of this.players) {
      if (player.stake <= 0) continue;
      player.cashedOut
        ? winners.push({ playerId, player })
        : losers.push({ playerId, player });
    }

    // ── Step 2: House cut + prize pool ───────────────────────────────────────
    const houseCut = Math.round(pot * HOUSE_EDGE * 100) / 100;
    const prizePool = Math.round((pot - houseCut) * 100) / 100;

    // ── Step 3: Score every winner ───────────────────────────────────────────
    const withProximity = winners.map(({ playerId, player }) => {
      const gap = Math.max(crashedAt - player.cashoutMultiplier!, 0.001);
      return { playerId, player, proximity: 1 / gap };
    });

    const totalProximity = withProximity.reduce((s, x) => s + x.proximity, 0);

    const scored = withProximity.map(({ playerId, player, proximity }) => {
      const stakeScore = pot > 0 ? player.stake / pot : 0;
      const proximityScore = totalProximity > 0 ? proximity / totalProximity : 0;

      const score =
        Math.round(
          (WEIGHT_STAKE * stakeScore + WEIGHT_RISK * proximityScore) * 1e8,
        ) / 1e8;

      return { playerId, player, score };
    });

    const totalScore = scored.reduce((sum, s) => sum + s.score, 0);

    // ── Step 4: Distribute prize pool proportionally by score ─────────────────
    let totalPaidOut = 0;

    for (const { playerId, player, score } of scored) {
      const payout =
        prizePool > 0 && totalScore > 0
          ? Math.round(prizePool * (score / totalScore) * 100) / 100
          : 0;

      player.actualPayout = payout;
      totalPaidOut += payout;

      const cacheEntry = this.walletCache.get(playerId);
      if (cacheEntry) cacheEntry.balance += payout;
    }

    // ── Step 5: Build round results ───────────────────────────────────────────
    const results: RoundResult = {};

    for (const { playerId, player } of winners) {
      results[playerId] = {
        stake: player.stake,
        cashedOut: true,
        cashoutMultiplier: player.cashoutMultiplier!,
        payout: player.actualPayout,
        surplusShare: 0,
        totalReturn: player.actualPayout,
        profit: Math.round((player.actualPayout - player.stake) * 100) / 100,
      };
    }

    for (const { playerId, player } of losers) {
      results[playerId] = {
        stake: player.stake,
        cashedOut: false,
        payout: 0,
        surplusShare: 0,
        totalReturn: 0,
        profit: -player.stake,
      };
    }

    // ── Step 6: Sync wallets to DB (fire-and-forget) ──────────────────────────
    //
    // syncWallet takes a DELTA (DB does: currentBalance + delta).
    // Stakes were deducted from local cache at bet time but not yet in DB.
    //
    //   Winners: delta = actualPayout - stake
    //            (payout credited minus stake deducted = net change)
    //
    //   Losers:  delta = -stake
    //            (stake deducted, nothing back)
    //
    for (const { playerId, player } of winners) {
      const delta = Math.round((player.actualPayout - player.stake) * 100) / 100;
      CocobaseHelper.syncWallet(playerId, delta).catch((e) =>
        console.error(`[Aviator] Failed to sync winner wallet ${playerId}:`, e),
      );
    }

    for (const { playerId, player } of losers) {
      const delta = -player.stake;
      CocobaseHelper.syncWallet(playerId, delta).catch((e) =>
        console.error(`[Aviator] Failed to sync loser wallet ${playerId}:`, e),
      );
    }

    CocobaseHelper.syncWallet("admin", houseCut).catch((e) =>
      console.error("[Aviator] Failed to sync house cut:", e),
    );

    // ── Step 7: Persist round history ─────────────────────────────────────────
    CocobaseHelper.saveHistory("aviator", {
      roundId: this.roundId,
      crashMultiplier: crashedAt,
      totalPot: pot,
      prizePool,
      totalPaidOut,
      houseCut,
      results,
      playerIds: Object.keys(results),
    });

    // ── Step 8: Broadcast final result ───────────────────────────────────────
    this.emit("broadcast", {
      type: "round_crashed",
      multiplier: crashedAt,
      results,
      prizePool,
      houseCut,
    });

    this.waitingTicks = ENDED_WAITING_TIME;
    setTimeout(() => this.resetRound(), 3000);
  }

  // ============================================================
  // RESET
  // ============================================================
  private resetRound() {
    this.status = "WAITING";
    this.multiplier = 1.0;
    this.players.clear();
    this.walletCache.clear();
    this.totalStaked = 0;
    this.starting = false;
    this.readyToStart = false;
    this.waitingTicks = WAITING_TIME_NO_STAKES;
    this.roundId = this.generateRoundId();
    this.serverSeed = Math.random().toString();
    this.crashMultiplier = null;
    this.tick = 0;
    this.emit("broadcast", { type: "round_reset" });
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private generateCrashPoint(): number {
    const r = Math.random();
    if (r < 0.01) return 1.0;
    return Math.round((0.99 / (1 - r)) * 100) / 100;
  }

  private generateRoundId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}