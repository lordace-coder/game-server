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
  status:
    | "WAITING"
    | "STARTING"
    | "STREAMING"
    | "PREDICTING"
    | "REVEALING"
    | "ENDED";
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

  public async onTick() {
    const st = this.room;

    if (
      st.tickCount % 100 === 0 &&
      ["STREAMING", "PREDICTING", "REVEALING"].includes(st.status)
    ) {
      this.emit("broadcast", {
        type: "pub_players",
        players: this.pubPlayers(),
      });
    }
    st.tickCount += 1;

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

    if (st.status === "STREAMING") {
      if (st.streamTicksRemaining > 0) {
        st.streamTicksRemaining -= 1;
        st.chartTick += 1;
        const newPrice = Math.max(
          st.price + st.trend + (Math.random() - 0.5) * PRICE_VOLATILITY,
          50,
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
        const predictTime = st.suddenDeath
          ? PREDICT_TIME_SUDDEN
          : PREDICT_TIME_NORMAL;
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

    if (st.status === "PREDICTING") {
      if (st.predictTicksRemaining > 0) {
        st.predictTicksRemaining -= 1;
        if (st.predictTicksRemaining % 50 === 0) {
          this.emit("broadcast", {
            type: "predict_countdown",
            secondsLeft: Math.max(
              0,
              (st.predictTicksRemaining * TICK_RATE) / 1000,
            ),
          });
        }
      }
      if (st.predictTicksRemaining === 0) {
        await this.revealRound();
      }
    }

    if (st.status === "REVEALING") {
      if (st.revealTicksRemaining > 0) {
        st.revealTicksRemaining -= 1;
      }
      if (st.revealTicksRemaining === 0) {
        await this.afterReveal();
      }
    }

    if (st.status === "ENDED") {
      if (st.waitingTicks > 0) {
        st.waitingTicks -= 1;
      }
      if (st.waitingTicks === 0) {
        await this.resetRoom();
      }
    }
  }

  public async handleDisconnect(userId: string) {
    const player = this.room.players.get(userId);
    if (!player) return;

    if (this.room.status === "WAITING" && player.hasLockedBet) {
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

    ws.send(JSON.stringify({ type: "lock_bet_success", bet: player.bet }));

    this.emit("broadcast", {
      type: "player_locked_bet",
      playerId: userId,
      username: player.username,
      bet: player.bet,
      totalPot: st.totalPot,
      lockedCount: st.lockedBetsCount,
      players: this.pubPlayers(),
    });

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
      JSON.stringify({ type: "cancel_bet_success", refunded: player.bet }),
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

    if (player.prediction !== null) {
      return ws.send(JSON.stringify({ error: "Already predicted" }));
    }

    if (direction !== "up" && direction !== "down") {
      return ws.send(JSON.stringify({ error: "Invalid direction" }));
    }

    player.prediction = direction as "up" | "down";
    ws.send(JSON.stringify({ type: "predict_success", direction }));

    const predictedCount = Array.from(st.players.values()).filter(
      (p) => p.hasLockedBet && p.prediction !== null,
    ).length;

    this.emit("broadcast", {
      type: "player_predicted",
      playerId: userId,
      username: player.username,
      predictedCount: predictedCount,
      totalInGame: st.lockedBetsCount,
    });

    const allPredicted = Array.from(st.players.values())
      .filter((p) => p.hasLockedBet)
      .every((p) => p.prediction !== null);

    if (allPredicted) {
      st.predictTicksRemaining = 0;
    }
  }

  private async startGame() {
    const st = this.room;
    st.currentRound = 0;
    st.scores = new Map();
    st.suddenDeath = false;
    st.phaseHistory = [];
    st.price = BASE_PRICE;
    st.priceHistory = [BASE_PRICE];
    st.chartTick = 0;

    for (const [playerId, player] of st.players) {
      if (player.hasLockedBet) {
        st.scores.set(playerId, 0);
      }
    }

    this.emit("broadcast", {
      type: "game_started",
      roundId: st.roundId,
      totalPot: st.totalPot,
      totalRounds: TOTAL_ROUNDS,
      playerCount: st.lockedBetsCount,
      players: this.pubPlayers(),
    });

    await this.startRound();
  }

  private async startRound() {
    const st = this.room;
    st.currentRound += 1;

    for (const player of st.players.values()) {
      if (player.hasLockedBet) {
        player.prediction = null;
      }
    }

    const goesUp = Math.random() > 0.5;
    st.direction = goesUp ? "up" : "down";
    st.trend =
      Math.random() > 0.4
        ? TREND_STRENGTH * (goesUp ? 1 : -1)
        : TREND_STRENGTH * (goesUp ? -1 : 1);

    st.status = "STREAMING";
    st.streamTicksRemaining =
      STREAM_TICKS_BASE + Math.floor(Math.random() * STREAM_TICKS_VARY);

    this.emit("broadcast", {
      type: "round_streaming",
      round: st.currentRound,
      suddenDeath: st.suddenDeath,
    });
  }

  private async revealRound() {
    const st = this.room;
    st.status = "REVEALING";
    st.revealTicksRemaining = REVEAL_TICKS;

    const correct = st.direction!;
    const goesUp = correct === "up";
    const revTrend = TREND_STRENGTH * 2.5 * (goesUp ? 1 : -1);

    const revealPrices: number[] = [];
    let price = st.price;
    for (let i = 0; i < 25; i++) {
      price += revTrend + (Math.random() - 0.5) * 1.5;
      price = Math.max(price, 50);
      revealPrices.push(Math.round(price * 100) / 100);
    }

    st.price = revealPrices[revealPrices.length - 1];
    st.priceHistory.push(...revealPrices);

    const roundResults: any = {};
    for (const [playerId, player] of st.players) {
      if (player.hasLockedBet) {
        const pred = player.prediction;
        const gotIt = pred === correct;

        if (gotIt) {
          const newScore = (st.scores.get(playerId) || 0) + 1;
          st.scores.set(playerId, newScore);
        }

        roundResults[playerId] = {
          prediction: pred,
          correct: gotIt,
          timedOut: pred === null,
          score: st.scores.get(playerId) || 0,
        };
      }
    }

    st.phaseHistory.push({
      round: st.currentRound,
      direction: correct,
      results: roundResults,
    });

    this.emit("broadcast", {
      type: "round_result",
      round: st.currentRound,
      direction: correct,
      revealPrices: revealPrices,
      results: roundResults,
      scores: Object.fromEntries(st.scores),
      suddenDeath: st.suddenDeath,
    });
  }

  private async afterReveal() {
    const st = this.room;

    if (!st.suddenDeath && st.currentRound < TOTAL_ROUNDS) {
      await this.startRound();
      return;
    }

    const topScore = Math.max(...Array.from(st.scores.values()));
    const leaders = Array.from(st.scores.entries())
      .filter(([, s]) => s === topScore)
      .map(([id]) => id);

    if (leaders.length === 1) {
      await this.endGame(leaders[0]);
    } else {
      st.scoresSnapshot = new Map(st.scores);
      st.scores = new Map(
        Array.from(st.scores.entries()).filter(([id]) => leaders.includes(id)),
      );
      st.suddenDeath = true;

      const allGamePids = Array.from(st.players.entries())
        .filter(([, p]) => p.hasLockedBet)
        .map(([id]) => id);
      const eliminated = allGamePids.filter((id) => !leaders.includes(id));

      this.emit("broadcast", {
        type: "sudden_death",
        tiedPlayers: leaders.map((pid) => ({
          id: pid,
          username: st.players.get(pid)!.username,
          score: st.scores.get(pid),
        })),
        eliminated: eliminated.map((pid) => ({
          id: pid,
          username: st.players.get(pid)!.username,
        })),
      });

      await this.startRound();
    }
  }

  private async endGame(winnerId: string) {
    const st = this.room;
    st.status = "ENDED";
    st.waitingTicks = ENDED_WAIT;

    const totalPot = st.totalPot;
    const houseCut = Math.round(totalPot * HOUSE_EDGE * 100) / 100;
    const prize = Math.round((totalPot - houseCut) * 100) / 100;
    const winnerName = st.players.get(winnerId)!.username;

    // TODO: Queue background tasks via Cocobase.queue.add()

    this.emit("broadcast", {
      type: "game_ended",
      winnerId: winnerId,
      winnerUsername: winnerName,
      prize: prize,
      totalPot: totalPot,
      houseCut: houseCut,
      finalScores: Object.fromEntries(st.scores),
      totalRounds: st.currentRound,
      hadSuddenDeath: st.suddenDeath,
      standings: this.getStandings(),
    });
  }

  private async resetRoom() {
    const st = this.room;

    for (const [playerId, player] of st.players) {
      if (player.connected) {
        player.prediction = null;
        player.hasLockedBet = false;
      } else {
        st.players.delete(playerId);
      }
    }

    this.room = this.initRoomState();
    this.room.players = st.players;

    this.emit("broadcast", {
      type: "round_reset",
      roundId: st.roundId,
      players: this.pubPlayers(),
    });
  }

  private initRoomState(): RoomState {
    return {
      status: "WAITING",
      players: new Map(),
      roundId: `PS_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      waitingTicks: WAITING_TIME_IDLE,
      readyToStart: false,
      startingTicks: 0,
      totalPot: 0,
      lockedBetsCount: 0,
      price: BASE_PRICE,
      priceHistory: [BASE_PRICE],
      chartTick: 0,
      streamTicksRemaining: 0,
      currentRound: 0,
      direction: null,
      predictTicksRemaining: 0,
      revealTicksRemaining: 0,
      scores: new Map(),
      scoresSnapshot: new Map(),
      suddenDeath: false,
      phaseHistory: [],
      trend: 0,
      serverSeed: Math.random().toString(),
      walletCache: new Map(),
      tickCount: 0,
    };
  }

  private countConnected(): number {
    return Array.from(this.room.players.values()).filter((p) => p.connected)
      .length;
  }

  private pubPlayers() {
    return Object.fromEntries(
      Array.from(this.room.players.entries()).map(([playerId, player]) => [
        playerId,
        {
          username: player.username,
          bet: player.bet,
          connected: player.connected,
          hasLockedBet: player.hasLockedBet,
          score: this.room.scores.get(playerId) || 0,
        },
      ]),
    );
  }

  private getStandings() {
    const standings = Array.from(this.room.scores.entries())
      .map(([id, score]) => ({
        id,
        username: this.room.players.get(id)!.username,
        score,
      }))
      .sort((a, b) => b.score - a.score);
    return standings;
  }

  public getSafeState(playerId: string) {
    const st = this.room;
    const myPlayer = st.players.get(playerId);

    return {
      status: st.status,
      roundId: st.roundId,
      totalPot: st.totalPot,
      price: st.price,
      priceHistory: st.priceHistory.slice(-100),
      currentRound: st.currentRound,
      totalRounds: TOTAL_ROUNDS,
      scores: Object.fromEntries(st.scores),
      suddenDeath: st.suddenDeath,
      myBet: myPlayer?.bet || 0,
      myHasLockedBet: myPlayer?.hasLockedBet || false,
      myPrediction: myPlayer?.prediction || null,
      myScore: st.scores.get(playerId) || 0,
      playerCount: this.countConnected(),
      lockedBetsCount: st.lockedBetsCount,
      players: this.pubPlayers(),
      phaseHistory: st.phaseHistory.slice(-20),
    };
  }
}
