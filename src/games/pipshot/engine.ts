import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { Cocobase } from "../../core/cocobase";

const TICK_RATE = 20;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 50;
const TOTAL_ROUNDS = 5;
const PREDICT_TIME_NORMAL = 400;
const PREDICT_TIME_SUDDEN = 200;
const STREAM_TICKS_BASE = 60;
const STREAM_TICKS_VARY = 30;
const REVEAL_TICKS = 80;
const WAITING_TIME_READY = 250;
const WAITING_TIME_IDLE = 250;
const ENDED_WAIT = 200;
const STARTING_TICKS = 60;
const HOUSE_EDGE = 0.01;
const PRICE_VOLATILITY = 3.0;
const TREND_STRENGTH = 0.4;
const BASE_PRICE = 500.0;

interface PlayerState {
  username: string;
  connected: boolean;
  bet: number;
  hasLockedBet: boolean;
  prediction: "up" | "down" | null;
  score: number;
}

interface WalletCacheEntry {
  id: string;
  balance: number;
}

interface RoomState {
  status: "WAITING" | "STARTING" | "STREAMING" | "PREDICTING" | "REVEALING" | "ENDED";
  players: Map<string, PlayerState>;
  roundId: string;
  waitingTicks: number;
  readyToStart: boolean;
  startingTicks: number;
  totalPot: number;
  lockedBetsCount: number;
  price: number;
  priceHistory: number[];
  chartTick: number;
  streamTicksRemaining: number;
  currentRound: number;
  direction: "up" | "down" | null;
  predictTicksRemaining: number;
  revealTicksRemaining: number;
  scores: Map<string, number>;
  scoresSnapshot: Map<string, number>;
  suddenDeath: boolean;
  phaseHistory: any[];
  trend: number;
  serverSeed: string;
  walletCache: Map<string, WalletCacheEntry>;
  tickCount: number;
}

export class PipShotEngine extends EventEmitter {
  private room: RoomState;

  constructor() {
    super();
    this.room = this.initRoomState();
  }

  public addPlayer(userId: string, username: string, bet: number) {
    this.room.players.set(userId, {
      username,
      connected: true,
      bet,
      hasLockedBet: false,
      prediction: null,
      score: 0,
    });
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
      case "lock_bet":
        await this.handleLockBet(ws, userId);
        break;
      case "cancel_bet":
        this.handleCancelBet(ws, userId);
        break;
      case "predict":
        this.handlePredict(ws, userId, payload.direction);
        break;
      default:
        ws.send(JSON.stringify({ error: "Invalid PipShot Action" }));
    }
  }

  /**
   * TICK LOOP - Pure in-memory, no DB calls
   */
  public async onTick() {
    const st = this.room;

    // Periodic pub_players broadcast
    if (st.tickCount % 100 === 0 && ["STREAMING", "PREDICTING", "REVEALING"].includes(st.status)) {
      this.emit("broadcast", {
        type: "pub_players",
        players: this.pubPlayers(),
      });
    }
    st.tickCount += 1;

    // ---- WAITING ----
    if (st.status === "WAITING") {
      if (st.waitingTicks > 0) {
        st.waitingTicks -= 1;
        if (st.waitingTicks % 50 === 0 && st.readyToStart) {
          this.emit("broadcast", {
            type: "waiting_tick",
            secondsLeft: Math.max(0, (st.waitingTicks * TICK_RATE) / 1000),
          });
        }
      }

      if (st.waitingTicks === 0 && st.lockedBetsCount >= MIN_PLAYERS) {
        st.status = "STARTING";
        st.startingTicks = STARTING_TICKS;
        this.emit("broadcast", {
          type: "game_starting",
          seconds: (STARTING_TICKS * TICK_RATE) / 1000,
        });
      } else if (st.waitingTicks === 0 && st.lockedBetsCount < MIN_PLAYERS) {
        st.waitingTicks = WAITING_TIME_IDLE;
        st.readyToStart = false;
      }
    }

    // ---- STARTING ----
    if (st.status === "STARTING") {
      if (st.startingTicks > 0) {
        st.startingTicks -= 1;
        if (st.startingTicks % 50 === 0) {
          this.emit("broadcast", {
            type: "starting_tick",
            secondsLeft: Math.max(0, (st.startingTicks * TICK_RATE) / 1000),
          });
        }
      }

      if (st.startingTicks === 0) {
        await this.startGame();
      }
    }

    // ---- STREAMING ----
    if (st.status === "STREAMING") {
      if (st.streamTicksRemaining > 0) {
        st.streamTicksRemaining -= 1;
        st.chartTick += 1;

        const newPrice = Math.max(
          st.price + st.trend + (Math.random() - 0.5) * PRICE_VOLATILITY,
          50
        );
        st.price = Math.round(newPrice * 100) / 100;
        st.priceHistory.push(st.price);

        if (st.chartTick % 2 === 0) {
          this.emit("broadcast", {
            type: "price_update",
            price: st.price,
            tick: st.chartTick,
          });
        }
      }

      if (st.streamTicksRemaining === 0) {
        st.status = "PREDICTING";
        const predictTime = st.suddenDeath ? PREDICT_TIME_SUDDEN : PREDICT_TIME_NORMAL;
        st.predictTicksRemaining = predictTime;

        this.emit("broadcast", {
          type: "predict_now",
          round: st.currentRound,
          price: st.price,
          seconds: (predictTime * TICK_RATE) / 1000,
          suddenDeath: st.suddenDeath,
        });
      }
    }

    // ---- PREDICTING ----
    if (st.status === "PREDICTING") {
      if (st.predictTicksRemaining > 0) {
        st.predictTicksRemaining -= 1;
        if (st.predictTicksRemaining % 50 === 0) {
          this.emit("broadcast", {
            type: "predict_countdown",
            secondsLeft: Math.max(0, (st.predictTicksRemaining * TICK_RATE) / 1000),
          });
        }
      }

      if (st.predictTicksRemaining === 0) {
        await this.revealRound();
      }
    }

    // ---- REVEALING ----
    if (st.status === "REVEALING") {
      if (st.revealTicksRemaining > 0) {
        st.revealTicksRemaining -= 1;
      }

      if (st.revealTicksRemaining === 0) {
        await this.afterReveal();
      }
    }

    // ---- ENDED ----
    if (st.status === "ENDED") {
      if (st.waitingTicks > 0) {
        st.waitingTicks -= 1;
      }

      if (st.waitingTicks === 0) {
        await this.resetRoom();
      }
    }
  }

  /**
   * DISCONNECT HANDLER
   */
  public async handleDisconnect(userId: string) {
    const player = this.room.players.get(userId);
    if (!player) return;

    if (this.room.status === "WAITING" && player.hasLockedBet) {
      // TODO: Queue refund task
      // queue.add("process_bet_refund", { userId, betAmount: player.bet });
      player.hasLockedBet = false;
      this.room.totalPot -= player.bet;
      this.room.lockedBetsCount -= 1;
    }

    player.connected = false;

    this.emit("broadcast", {
      type: "player_left",
      playerId: userId,
      username: player.username,
      playerCount: this.countConnected(),
      players: this.pubPlayers(),
    });
  }

  // ============================================================
  // ACTION HANDLERS
  // ============================================================

  private async handleLockBet(ws: WebSocket, userId: string) {
    const st = this.room;
    if (st.status !== "WAITING") {
      return ws.send(JSON.stringify({ error: "Game already in progress" }));
    }

    let player = st.players.get(userId);
    if (!player) {
      return ws.send(JSON.stringify({ error: "Player not found" }));
    }

    if (player.hasLockedBet) {
      return ws.send(JSON.stringify({ error: "Already locked bet" }));
    }

    // Load wallet if not cached
    if (!st.walletCache.has(userId)) {
      const balance = await Cocobase.getBalance(userId);
      st.walletCache.set(userId, { id: userId, balance });
    }

    const cacheEntry = st.walletCache.get(userId)!;
    if (cacheEntry.balance < player.bet) {
      return ws.send(JSON.stringify({ error: "Insufficient balance" }));
    }

    player.hasLockedBet = true;
    st.totalPot += player.bet;
    st.lockedBetsCount += 1;

    ws.send(
      JSON.stringify({
        type: "lock_bet_success",
        bet: player.bet,
      }),
    );

    this.emit("broadcast", {
      type: "player_locked_bet",
      playerId: userId,
      username: player.username,
      bet: player.bet,
      totalPot: st.totalPot,
      lockedCount: st.lockedBetsCount,
      players: this.pubPlayers(),
    });

    // Start countdown if min players reached
    if (st.lockedBetsCount >= MIN_PLAYERS && !st.readyToStart) {
      st.readyToStart = true;
      st.waitingTicks = WAITING_TIME_READY;
      this.emit("broadcast", {
        type: "countdown_started",
        seconds: (WAITING_TIME_READY * TICK_RATE) / 1000,
      });
    }
  }

  private handleCancelBet(ws: WebSocket, userId: string) {
    const st = this.room;
    if (st.status !== "WAITING") {
      return ws.send(JSON.stringify({ error: "Cannot cancel now" }));
    }

    const player = st.players.get(userId);
    if (!player || !player.hasLockedBet) {
      return ws.send(JSON.stringify({ error: "No bet to cancel" }));
    }

    player.hasLockedBet = false;
    st.totalPot -= player.bet;
    st.lockedBetsCount -= 1;

    ws.send(
      JSON.stringify({
        type: "cancel_bet_success",
        refunded: player.bet,
      }),
    );

    this.emit("broadcast", {
      type: "bet_cancelled",
      playerId: userId,
      totalPot: st.totalPot,
      lockedCount: st.lockedBetsCount,
      players: this.pubPlayers(),
    });
  }

  private handlePredict(ws: WebSocket, userId: string, direction: string) {
    const st = this.room;
    if (st.status !== "PREDICTING") {
      return ws.send(JSON.stringify({ error: "Not prediction phase" }));
    }

    const player = st.players.get(userId);
    if (!player || !player.hasLockedBet) {
      return ws.send(JSON.stringify({ error: "Not in game" }));
    }

    if
