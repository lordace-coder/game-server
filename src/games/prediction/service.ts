// Prediction game data service — CocoBase-backed.
//
// Responsibilities:
//  - create / list / update prediction markets
//  - record user bets (deducting the stake from the wallet)
//  - resolve (validate) a market: pay out winners from the losers' pool,
//    minus the admin-defined house percentage.
import { db } from "../../core/cocobase";
import { Prediction, PredictionBet, PredictionStatus } from "../../types/documents";
import {
  computeSettlement,
  clampPercentage,
  SettlementResult,
} from "./settlement";

const PREDICTIONS = "predictions";
const BETS = "prediction_bets";
const WALLETS = "wallets";

interface CocoDoc<T> {
  id: string;
  data: T;
}

export interface CreatePredictionInput {
  title: string;
  description?: string;
  options: string[];
  house_percentage: number;
  closes_at?: string | null;
  created_by?: string;
}

export interface PlaceBetInput {
  prediction_id: string;
  user_id: string;
  option_index: number;
  amount: number;
}

export class PredictionService {
  // ── Markets ────────────────────────────────────────────────────────────────
  static async list(status?: PredictionStatus) {
    const res = await db.listDocuments<Prediction>(PREDICTIONS, {
      ...(status ? { filters: { status } } : {}),
      sort: "created_at",
      order: "desc",
      limit: 200,
    });
    return res.map((d: CocoDoc<Prediction>) => ({ id: d.id, ...d.data }));
  }

  static async get(id: string): Promise<CocoDoc<Prediction> | null> {
    const res = await db.listDocuments<Prediction>(PREDICTIONS, {
      filters: { id },
      limit: 1,
    });
    return res[0] ?? null;
  }

  static async create(input: CreatePredictionInput) {
    const options = (input.options || []).map((o) => String(o).trim()).filter(Boolean);
    if (!input.title || !input.title.trim()) throw new Error("Title is required");
    if (options.length < 2) throw new Error("At least two options are required");

    const doc = await db.createDocument(PREDICTIONS, {
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
      options,
      house_percentage: clampPercentage(Number(input.house_percentage) || 0),
      status: "open" as PredictionStatus,
      winning_option: null,
      closes_at: input.closes_at ?? null,
      created_by: input.created_by ?? "",
      created_at: new Date().toISOString(),
      resolved_at: null,
      house_collected: 0,
      total_pool: 0,
    });
    return { id: doc.id, ...(doc.data ?? doc) };
  }

  static async setStatus(id: string, status: Exclude<PredictionStatus, "resolved">) {
    await db.updateDocument(PREDICTIONS, id, { status });
  }

  static async setHousePercentage(id: string, housePercentage: number) {
    await db.updateDocument(PREDICTIONS, id, {
      house_percentage: clampPercentage(Number(housePercentage) || 0),
    });
  }

  // ── Bets ─────────────────────────────────────────────────────────────────
  static async listBets(predictionId: string) {
    const res = await db.listDocuments<PredictionBet>(BETS, {
      filters: { prediction_id: predictionId },
      limit: 1000,
    });
    return res.map((d: CocoDoc<PredictionBet>) => ({ id: d.id, ...d.data }));
  }

  /**
   * Place a bet. Validates the market is open and the wallet has funds,
   * deducts the stake, and records the bet.
   */
  static async placeBet(input: PlaceBetInput) {
    const market = await this.get(input.prediction_id);
    if (!market) throw new Error("Prediction not found");
    if (market.data.status !== "open") throw new Error("Betting is closed");
    if (
      input.option_index < 0 ||
      input.option_index >= market.data.options.length
    ) {
      throw new Error("Invalid option");
    }
    const amount = Math.floor(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

    // Deduct stake from wallet.
    const wallet = await this.getWallet(input.user_id);
    if (!wallet) throw new Error("Wallet not found");
    const balance = Number(wallet.data.coins_balance ?? 0);
    if (balance < amount) throw new Error("Insufficient balance");
    await db.updateDocument(WALLETS, wallet.id, {
      coins_balance: balance - amount,
    });

    const doc = await db.createDocument(BETS, {
      prediction_id: input.prediction_id,
      user_id: input.user_id,
      option_index: input.option_index,
      amount,
      status: "active",
      payout: 0,
      created_at: new Date().toISOString(),
      settled_at: null,
    });

    await db.updateDocument(PREDICTIONS, input.prediction_id, {
      total_pool: Number(market.data.total_pool ?? 0) + amount,
    });

    return { id: doc.id, ...(doc.data ?? doc) };
  }

  // ── Resolve / validate ─────────────────────────────────────────────────────
  static async resolve(
    predictionId: string,
    winningOption: number
  ): Promise<SettlementResult> {
    const market = await this.get(predictionId);
    if (!market) throw new Error("Prediction not found");
    if (market.data.status === "resolved") throw new Error("Already resolved");
    if (winningOption < 0 || winningOption >= market.data.options.length) {
      throw new Error("Invalid winning option");
    }

    const betDocs = await db.listDocuments<PredictionBet>(BETS, {
      filters: { prediction_id: predictionId },
      limit: 1000,
    });
    const bets = betDocs.map((d: CocoDoc<PredictionBet>) => ({
      id: d.id,
      user_id: d.data.user_id,
      option_index: Number(d.data.option_index),
      amount: Number(d.data.amount),
    }));

    const settlement = computeSettlement(
      bets,
      winningOption,
      market.data.house_percentage
    );

    // Credit winners / refunds.
    for (const p of settlement.payouts) {
      if (p.payout <= 0) continue;
      await this.creditWallet(p.userId, p.payout);
    }

    // Mark bets.
    const now = new Date().toISOString();
    for (const p of settlement.payouts) {
      const status = p.refunded ? "refunded" : p.won ? "won" : "lost";
      await db.updateDocument(BETS, p.betId, {
        status,
        payout: p.payout,
        settled_at: now,
      });
    }

    // Mark market resolved.
    await db.updateDocument(PREDICTIONS, predictionId, {
      status: "resolved",
      winning_option: winningOption,
      resolved_at: now,
      house_collected: settlement.houseCut,
      total_pool: settlement.totalPool,
    });

    return settlement;
  }

  // ── Wallet helpers ─────────────────────────────────────────────────────────
  private static async getWallet(userId: string) {
    const res = await db.listDocuments<{ coins_balance: number; user_id: string }>(
      WALLETS,
      { filters: { user_id: userId }, limit: 1 }
    );
    return res[0] ?? null;
  }

  private static async creditWallet(userId: string, amount: number) {
    const wallet = await this.getWallet(userId);
    if (!wallet) {
      console.warn(`[predictions] No wallet for ${userId}, cannot credit ${amount}`);
      return;
    }
    const current = Number(wallet.data.coins_balance ?? 0);
    await db.updateDocument(WALLETS, wallet.id, {
      coins_balance: current + amount,
    });
  }
}
