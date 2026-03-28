import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { CocobaseHelper } from "../../core/cocobase"; // Import our Accountant

// ============================================================
// CONSTANTS
// ============================================================
const TICK_RATE = 20;
const MULTIPLIER_INCREMENT = 0.01;
const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER = 100.0;
const HOUSE_EDGE = 0.01;
const MIN_CRASH = 1.01;
const MAX_CRASH = 10.0;

const MIN_PLAYERS_TO_START = 2;
const WAITING_TIME_INITIAL = 250;
const WAITING_TIME_READY = 500;
const WAITING_TIME_NO_STAKES = 250;
const ENDED_WAITING_TIME = 150;

// ============================================================
// TYPES
// ============================================================
interface PlayerState {
  stake: number;
  cashedOut: boolean;
  cashoutMultiplier: number | null;
  payout: number;
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
    profit: number;
  };
}

export class AviatorEngine extends EventEmitter {
  public status: "WAITING" | "RUNNING" | "ENDED" = "WAITING";
  public multiplier: number = 1.0;
  private crashPoint: number = 0;
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

  // Memory Cache for this specific game instance
  private players: Map<string, PlayerState> = new Map();
  private walletCache: Map<string, WalletCacheEntry> = new Map();

  constructor() {
    super();
    this.roundId = this.generateRoundId();
    this.serverSeed = Math.random().toString();
  }

  /**
   * MAIN ACTION HANDLER
   * Called by hub.ts when a user sends a message
   */
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

  /**
   * TICK LOOP
   * Called each frame to handle waiting, running, and ended states
   */
  public async onTick() {
    // ---- WAITING ----
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

    // ---- RUNNING ----
    // (handled by startRound's setInterval)

    // ---- ENDED ----
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

  /**
   * DISCONNECT HANDLER
   * Called when a player disconnects
   */
  public async handleDisconnect(userId: string) {
    const player = this.players.get(userId);
    if (!player) return;

    // If in waiting phase with stake, refund immediately
    if (this.status === "WAITING" && player.stake > 0) {
      const refund = player.stake;
      player.stake = 0;
      this.totalStaked -= refund;

      // TODO: Must await directly here — player is leaving now
      // await CocobaseHelper.updateWallet(cacheEntry.id, cacheEntry.balance);
    }

    player.connected = false;

    this.emit("broadcast", {
      type: "player_left",
      playerId: userId,
    });
  }

  private async handleStake(ws: WebSocket, userId: string, amount: number) {
    if (this.status !== "WAITING")
      return ws.send(JSON.stringify({ error: "Round started" }));

    if (amount <= 0)
      return ws.send(JSON.stringify({ error: "Invalid stake amount" }));

    // 1. Check local cache, if empty, fetch from CocobaseHelper
    let cacheEntry = this.walletCache.get(userId);
    if (!cacheEntry) {
      const balance = await CocobaseHelper.getBalance(userId);
      // TODO: Handle wallet not found case
      cacheEntry = { id: userId, balance };
      this.walletCache.set(userId, cacheEntry);
    }

    if (cacheEntry.balance < amount)
      return ws.send(JSON.stringify({ error: "Insufficient balance" }));

    // 2. Deduct from cache and add to game (no DB write yet)
    const oldStake = this.players.get(userId)?.stake || 0;
    cacheEntry.balance -= amount;
    this.totalStaked = this.totalStaked - oldStake + amount;

    this.players.set(userId, {
      stake: amount,
      cashedOut: false,
      cashoutMultiplier: null,
      payout: 0,
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
      amount: amount,
      totalPot: this.totalStaked,
    });

    // Logic to start game if players >= MIN_PLAYERS_TO_START
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

  private handleCashout(ws: WebSocket, userId: string) {
    const player = this.players.get(userId);
    if (this.status === "RUNNING" && player && !player.cashedOut) {
      player.cashedOut = true;
      const payout = Math.round(player.stake * this.multiplier * 100) / 100;
      player.payout = payout;
      player.cashoutMultiplier = this.multiplier;

      // Update Cache
      const cacheEntry = this.walletCache.get(userId);
      if (cacheEntry) {
        cacheEntry.balance += payout;
        // TODO: Fire-and-forget queue write via CocobaseHelper.queue.add()
        // queue.add("write_wallet_task", { walletId: cacheEntry.id, balance: cacheEntry.balance });
      }

      ws.send(
        JSON.stringify({
          type: "cashout_success",
          payout: payout,
          multiplier: this.multiplier,
        }),
      );

      this.emit("broadcast", {
        type: "player_cashed_out",
        playerId: userId,
        multiplier: this.multiplier,
        payout: payout,
      });
    }
  }

  private handleCancelStake(ws: WebSocket, userId: string) {
    if (this.status !== "WAITING") {
      return ws.send(
        JSON.stringify({ error: "Cannot cancel during active round" }),
      );
    }

    const player = this.players.get(userId);
    if (!player || player.stake <= 0) {
      return ws.send(JSON.stringify({ error: "No active stake" }));
    }

    const cancelled = player.stake;
    player.stake = 0;
    this.totalStaked -= cancelled;

    const cacheEntry = this.walletCache.get(userId);
    if (cacheEntry) {
      cacheEntry.balance += cancelled;
    }

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

      // Emit to hub.ts to broadcast to all players
      this.emit("broadcast", { type: "tick", multiplier: this.multiplier });

      if (this.crashMultiplier && this.multiplier >= this.crashMultiplier) {
        this.crash();
      }
    }, 50); // 20Hz
  }

  private crash() {
    if (this.interval) clearInterval(this.interval);
    this.status = "ENDED";

    this.emit("broadcast", { type: "crashed", multiplier: this.multiplier });

    // Build round results with house cut calculation
    const results: RoundResult = {};
    let houseCut = 0;

    for (const [playerId, player] of this.players) {
      if (player.stake <= 0) continue;

      if (player.cashedOut) {
        results[playerId] = {
          stake: player.stake,
          cashedOut: true,
          cashoutMultiplier: player.cashoutMultiplier!,
          payout: player.payout,
          profit: Math.round((player.payout - player.stake) * 100) / 100,
        };
      } else {
        // Player lost - house gets the stake
        houseCut += player.stake;
        results[playerId] = {
          stake: player.stake,
          cashedOut: false,
          payout: 0,
          profit: -player.stake,
        };
      }
    }

    // TODO: Queue background tasks for reliable execution via CocobaseHelper.queue.add()
    // Flush all dirty wallet entries — non-blocking
    // queue.add("write_wallet_task", {
    //   wallets: Array.from(this.walletCache.entries()).map(([id, entry]) => ({
    //     walletId: entry.id,
    //     balance: entry.balance
    //   }))
    // });

    // TODO: Credit admin wallet with house cut via queue
    // queue.add("credit_admin_task", { houseCut: houseCut });

    // TODO: Save round history via queue
    // queue.add("save_history_task", {
    //   roundId: this.roundId,
    //   crashMultiplier: this.crashMultiplier,
    //   totalPot: this.totalStaked,
    //   houseCut: houseCut,
    //   results: results,
    //   playerIds: Object.keys(results),
    //   timestamp: Date.now()
    // });

    this.emit("broadcast", {
      type: "round_crashed",
      multiplier: this.multiplier,
      results: results,
      houseCut: houseCut,
    });

    this.waitingTicks = ENDED_WAITING_TIME;
    setTimeout(() => this.resetRound(), 3000);
  }

  private resetRound() {
    this.status = "WAITING";
    this.multiplier = 1.0;
    this.players.clear();
    this.walletCache.clear(); // Clear wallet cache after round ends
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

  private generateCrashPoint(): number {
    const r = Math.random();
    if (r < 0.01) return 1.0;
    return Math.round((0.99 / (1 - r)) * 100) / 100;
  }

  private generateRoundId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
