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

// ── House & surplus config ───────────────────────────────────
// House takes AT MOST this % of the pot — the rest goes back to players
const HOUSE_EDGE_CAP = 0.03; // 3%

// How the surplus pool is weighted between the two scoring factors
const WEIGHT_STAKE = 0.5; // 50% — proportional to how much they bet
const WEIGHT_RISK = 0.5; // 50% — proportional to their cashout multiplier
//       losers get the crash multiplier as their
//       risk score (they held all the way through)

// ============================================================
// TYPES
// ============================================================
interface PlayerState {
  stake: number;
  cashedOut: boolean;
  cashoutMultiplier: number | null;
  intendedPayout: number; // stake * cashoutMultiplier, before pot-scaling
  actualPayout: number; // final game payout after pot-scaling
  surplusShare: number; // bonus redistributed from the leftover pot
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
    player.intendedPayout =
      Math.round(player.stake * this.multiplier * 100) / 100;

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
  // CRASH — capped house edge + weighted surplus share-back
  // ============================================================
  private crash() {
    if (this.interval) clearInterval(this.interval);
    this.status = "ENDED";

    const crashedAt = this.multiplier;
    this.emit("broadcast", { type: "crashed", multiplier: crashedAt });

    const pot = this.totalStaked;

    // ── Step 1: Separate winners from losers ────────────────────────────────
    const winners: Array<{ playerId: string; player: PlayerState }> = [];
    const losers: Array<{ playerId: string; player: PlayerState }> = [];

    for (const [playerId, player] of this.players) {
      if (player.stake <= 0) continue;
      player.cashedOut
        ? winners.push({ playerId, player })
        : losers.push({ playerId, player });
    }

    // ── Step 2: Scale winner payouts to pot if needed ───────────────────────
    // Winners locked in stake * multiplier at cashout time.
    // If total intended > pot, scale everyone down so pot is never exceeded.
    const totalIntended = winners.reduce(
      (sum, { player }) => sum + player.intendedPayout,
      0,
    );

    const scaleFactor = totalIntended > pot ? pot / totalIntended : 1.0;

    let totalPaidToWinners = 0;

    for (const { playerId, player } of winners) {
      player.actualPayout =
        Math.round(player.intendedPayout * scaleFactor * 100) / 100;
      totalPaidToWinners += player.actualPayout;

      const cacheEntry = this.walletCache.get(playerId);
      if (cacheEntry) cacheEntry.balance += player.actualPayout;
    }

    // ── Step 3: What's left after winners are paid ──────────────────────────
    const remainder = Math.round((pot - totalPaidToWinners) * 100) / 100;

    // ── Step 4: House takes AT MOST HOUSE_EDGE_CAP % of the original pot ───
    const maxHouseCut = Math.round(pot * HOUSE_EDGE_CAP * 100) / 100;
    const actualHouseCut = Math.min(maxHouseCut, remainder);

    // ── Step 5: Everything left after house cut is the surplus pool ─────────
    const surplusPool = Math.round((remainder - actualHouseCut) * 100) / 100;

    // ── Step 6: Score every player for their share of the surplus pool ──────
    //
    // Two equally weighted factors:
    //
    //   STAKE SCORE — stake / totalPot
    //     Rewards bigger bets with a bigger share of the surplus.
    //
    //   RISK SCORE  — cashoutMultiplier / sumOfAllMultipliersThisRound
    //     Winners use their locked cashout multiplier.
    //     Losers use the crash multiplier — they held all the way and took
    //     the maximum possible risk, so they deserve full risk credit.
    //
    // finalScore = WEIGHT_STAKE * stakeScore + WEIGHT_RISK * riskScore
    //
    const allPlayers = [...winners, ...losers];

    const totalMultiplierSum = allPlayers.reduce((sum, { player }) => {
      const m = player.cashedOut ? player.cashoutMultiplier! : crashedAt;
      return sum + m;
    }, 0);

    const scored = allPlayers.map(({ playerId, player }) => {
      const stakeScore = pot > 0 ? player.stake / pot : 0;
      const riskMultiplier = player.cashedOut
        ? player.cashoutMultiplier!
        : crashedAt;
      const riskScore =
        totalMultiplierSum > 0 ? riskMultiplier / totalMultiplierSum : 0;

      const score =
        Math.round(
          (WEIGHT_STAKE * stakeScore + WEIGHT_RISK * riskScore) * 1e8,
        ) / 1e8;

      return { playerId, player, score };
    });

    const totalScore = scored.reduce((sum, s) => sum + s.score, 0);

    // ── Step 7: Distribute surplus and update wallet cache ──────────────────
    let totalSurplusDistributed = 0;

    for (const { playerId, player, score } of scored) {
      if (surplusPool <= 0 || totalScore === 0) break;

      const share = Math.round(surplusPool * (score / totalScore) * 100) / 100;
      player.surplusShare = share;
      totalSurplusDistributed += share;

      const cacheEntry = this.walletCache.get(playerId);
      if (cacheEntry) cacheEntry.balance += share;
    }

    // ── Step 8: Build results ────────────────────────────────────────────────
    const results: RoundResult = {};

    for (const { playerId, player } of winners) {
      const totalReturn =
        Math.round((player.actualPayout + player.surplusShare) * 100) / 100;
      results[playerId] = {
        stake: player.stake,
        cashedOut: true,
        cashoutMultiplier: player.cashoutMultiplier!,
        payout: player.actualPayout,
        surplusShare: player.surplusShare,
        totalReturn,
        profit: Math.round((totalReturn - player.stake) * 100) / 100,
      };
    }

    for (const { playerId, player } of losers) {
      const totalReturn = player.surplusShare;
      results[playerId] = {
        stake: player.stake,
        cashedOut: false,
        payout: 0,
        surplusShare: player.surplusShare,
        totalReturn,
        profit: Math.round((totalReturn - player.stake) * 100) / 100,
      };
    }

    // ── Step 9: Sync all wallets to DB (fire-and-forget) ────────────────────
    //
    // syncWallet takes a DELTA (DB does: currentBalance + delta).
    // Stake was deducted from cache at stake time but not yet written to DB,
    // so the delta must account for that deduction:
    //
    //   Winners:  delta = actualPayout + surplusShare - stake
    //   Losers:   delta = surplusShare - stake  (usually negative)
    //
    for (const { playerId, player } of winners) {
      const delta =
        Math.round(
          (player.actualPayout + player.surplusShare - player.stake) * 100,
        ) / 100;
      CocobaseHelper.syncWallet(playerId, delta).catch((e) =>
        console.error(`[Aviator] Failed to sync winner wallet ${playerId}:`, e),
      );
    }

    for (const { playerId, player } of losers) {
      const delta =
        Math.round((player.surplusShare - player.stake) * 100) / 100;
      CocobaseHelper.syncWallet(playerId, delta).catch((e) =>
        console.error(`[Aviator] Failed to sync loser wallet ${playerId}:`, e),
      );
    }

    CocobaseHelper.syncWallet("admin", actualHouseCut).catch((e) =>
      console.error("[Aviator] Failed to sync house cut:", e),
    );

    CocobaseHelper.saveHistory("aviator", {
      roundId: this.roundId,
      crashMultiplier: crashedAt,
      totalPot: pot,
      totalPaidToWinners,
      surplusPool,
      surplusDistributed: totalSurplusDistributed,
      houseCut: actualHouseCut,
      results,
      playerIds: Object.keys(results),
      timestamp: Date.now(),
    });

    this.emit("broadcast", {
      type: "round_crashed",
      multiplier: crashedAt,
      results,
      surplusPool,
      houseCut: actualHouseCut,
      scaleFactor: Math.round(scaleFactor * 10000) / 10000,
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
