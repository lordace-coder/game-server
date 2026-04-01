import { Cocobase } from "cocobase";
import { UserData, Wallet } from "../types/documents";
import "dotenv/config";

const db = new Cocobase({
  apiKey: process.env.COCOBASE_API_KEY || "",
  projectId: process.env.COCOBASE_PROJECT_ID || "",
});

export class CocobaseHelper {
  /**
   * Get wallet - Returns full wallet object with populated user data
   */
  static async getWallet(userId: string): Promise<Wallet | null> {
    try {
      const res = await db.listDocuments<Wallet>("wallets", {
        filters: {
          user_id: userId,
        },
        limit: 1,
        populate: ["user"],
      });
      if (res.length === 0) {
        console.warn(`[DB] No wallet found for ${userId}`);
        return null;
      }

      const walletData = res[0].data;
      const user: UserData | null = res[0]?.data.user?.data;

      return {
        ...walletData,
        user: user || undefined,
      };
    } catch (e) {
      console.error("Cocobase Fetch Error", e);
      return null;
    }
  }

  /**
   * Get balance - Called once when player enters a game
   */
  static async getBalance(userId: string): Promise<number> {
    try {
      const res = await db.listDocuments<Wallet>("wallets", {
        filters: {
          user_id: userId,
        },
        limit: 1,
      });
      if (res.length === 0) {
        console.warn(`[DB] No wallet found for ${userId}, returning 0`);
        return 0;
      }
      return res[0].data.coins_balance;
    } catch (e) {
      console.error("Cocobase Fetch Error", e);
      return 0;
    }
  }

  /**
   * Update balance - Fire-and-forget (No 'await' in hot loops)
   */
  static async syncWallet(userId: string, amount: number) {
    const wallet = await db.listDocuments<Wallet>("wallets", {
      filters: {
        user_id: userId,
      },
      limit: 1,
    });
    if (wallet.length === 0) {
      console.warn(`[DB] No wallet found for ${userId}, cannot sync`);
      return;
    }
    const currentBalance = wallet[0].data.coins_balance;
    const newBalance = currentBalance + amount;
    await db.updateDocument("wallets", wallet[0].id, {
      coins_balance: newBalance,
    });
  }

  /**
   * Save Game History
   */
  static saveHistory(gameType: string, data: any) {
    db.createDocument("game-history",{
      game:gameType,
      ...data
    })
  }
}
