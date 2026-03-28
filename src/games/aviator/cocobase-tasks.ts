// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/aviator/CocobaseHelper-tasks.ts
/**
 * Aviator CocobaseHelper Integration Tasks
 * Queue-based background tasks for reliable wallet and history updates
 * These should be called via CocobaseHelper.queue.add() from engine.ts
 */

// ============================================================
// WALLET FLUSH TASKS
// ============================================================

/**
 * Write wallet balances after game ends - Background task
 * Called: crash() → flush all dirty wallet cache entries
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function write_wallet_task(params: {
//   wallets: Array<{ walletId: string; balance: number }>;
// }) {
//   try {
//     console.log(`[WALLET] Flushing ${params.wallets.length} wallet entries`);
//
//     for (const wallet of params.wallets) {
//       await CocobaseHelper.updateWallet(wallet.walletId, wallet.balance);
//     }
//
//     console.log(`[WALLET] Flushed ${params.wallets.length} wallets successfully`);
//   } catch (error) {
//     console.error(`[WALLET] Error flushing wallets: ${error}`);
//   }
// }

// ============================================================
// HOUSE CUT TASK
// ============================================================

/**
 * Credit admin wallet with house cut - Background task
 * Called: crash() → send house edge to admin
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function credit_admin_task(params: { houseCut: number }) {
//   try {
//     if (params.houseCut <= 0) {
//       return;
//     }
//
//     console.log(`[ADMIN] Crediting house cut: $${params.houseCut}`);
//
//     const adminWallet = await CocobaseHelper.getWallet("admin");
//     if (!adminWallet) {
//       console.error(`[ADMIN] Admin wallet not found`);
//       return;
//     }
//
//     const currentBalance = adminWallet.coins_balance || 0;
//     const newBalance = currentBalance + params.houseCut;
//
//     await CocobaseHelper.updateWallet("admin", newBalance);
//     console.log(`[ADMIN] House cut credited: $${params.houseCut} → $${newBalance}`);
//   } catch (error) {
//     console.error(`[ADMIN] Error crediting house cut: ${error}`);
//   }
// }

// ============================================================
// HISTORY TASK
// ============================================================

/**
 * Save game round history - Background task
 * Called: crash() → records complete round data for stats/replay
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function save_history_task(params: {
//   roundId: string;
//   crashMultiplier: number;
//   totalPot: number;
//   houseCut: number;
//   results: { [playerId: string]: any };
//   playerIds: string[];
//   timestamp: number;
// }) {
//   try {
//     console.log(`[HISTORY] Saving round history: ${params.roundId}`);
//
//     const result = await CocobaseHelper.createGameHistory({
//       round_id: params.roundId,
//       game_type: "aviator",
//       crash_multiplier: params.crashMultiplier,
//       total_pot: params.totalPot,
//       house_cut: params.houseCut,
//       results: params.results,
//       members: params.playerIds,
//       timestamp: params.timestamp,
//     });
//
//     console.log(`[HISTORY] Saved: ${result.id}`);
//   } catch (error) {
//     console.error(`[HISTORY] Error saving history: ${error}`);
//   }
// }

// ============================================================
// QUEUE IMPLEMENTATION REQUIREMENTS
// ============================================================

/**
 * Expected CocobaseHelper.queue interface:
 *
 * queue.add(taskName: string, params: any): Promise<void>
 *   - Enqueues task for async execution
 *   - Returns immediately (non-blocking)
 *   - Task runs in background worker pool
 *   - Includes retry logic and error handling
 *
 * Example usage in engine.ts:
 *   await CocobaseHelper.queue.add("write_wallet_task", { wallets: [...] });
 *   await CocobaseHelper.queue.add("credit_admin_task", { houseCut });
 *   await CocobaseHelper.queue.add("save_history_task", { roundId, ... });
 *
 * Task registration:
 *   CocobaseHelper.queue.registerTask("write_wallet_task", write_wallet_task);
 *   CocobaseHelper.queue.registerTask("credit_admin_task", credit_admin_task);
 *   CocobaseHelper.queue.registerTask("save_history_task", save_history_task);
 */
