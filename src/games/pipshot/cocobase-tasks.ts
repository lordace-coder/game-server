// filepath: /home/patrick/Desktop/agalio-game-server/game-server/src/games/pipshot/CocobaseHelper-tasks.ts
/**
 * PipShot CocobaseHelper Integration Tasks
 * Queue-based background tasks for reliable wallet and history updates
 * These should be called via CocobaseHelper.queue.add() from engine.ts
 */

// ============================================================
// PAYOUT TASKS
// ============================================================

/**
 * Process winner payout - Background task
 * Called: endGame() → winner receives prize
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function process_winner_payout(winnerId: string, prize: number) {
//   try {
//     const wallet = await CocobaseHelper.getWallet(winnerId);
//     if (!wallet) {
//       console.error(`[PAYOUT] Winner wallet not found: ${winnerId}`);
//       return;
//     }
//
//     const currentBalance = wallet.coins_balance || 0;
//     const newBalance = currentBalance + prize;
//
//     await CocobaseHelper.updateWallet(winnerId, newBalance);
//     console.log(`[PAYOUT] Winner paid: ${winnerId} → $${newBalance} (+$${prize})`);
//   } catch (error) {
//     console.error(`[PAYOUT] Error: ${error}`);
//   }
// }

/**
 * Process house cut payment - Background task
 * Called: endGame() → platform fee to admin
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function process_house_cut(houseCut: number) {
//   try {
//     const adminWallet = await CocobaseHelper.getWallet("admin");
//     if (!adminWallet) {
//       console.log(`[HOUSE] Admin wallet not found - skipping`);
//       return;
//     }
//
//     const currentBalance = adminWallet.coins_balance || 0;
//     const newBalance = currentBalance + houseCut;
//
//     await CocobaseHelper.updateWallet("admin", newBalance);
//     console.log(`[HOUSE] House cut credited: $${houseCut} → Admin balance $${newBalance}`);
//   } catch (error) {
//     console.error(`[HOUSE] Error: ${error}`);
//   }
// }

/**
 * Process bet refund - Background task
 * Called: handleDisconnect() → refund when player leaves during WAITING
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function process_bet_refund(userId: string, betAmount: number) {
//   try {
//     const wallet = await CocobaseHelper.getWallet(userId);
//     if (!wallet) {
//       console.error(`[REFUND] Wallet not found: ${userId}`);
//       return;
//     }
//
//     const currentBalance = wallet.coins_balance || 0;
//     const newBalance = currentBalance + betAmount;
//
//     await CocobaseHelper.updateWallet(userId, newBalance);
//     console.log(`[REFUND] Refunded: ${userId} → $${newBalance} (+$${betAmount})`);
//   } catch (error) {
//     console.error(`[REFUND] Error: ${error}`);
//   }
// }

// ============================================================
// HISTORY TASKS
// ============================================================

/**
 * Save game history - Background task
 * Called: endGame() → records full game session
 */
// TODO: Implement via CocobaseHelper.queue.add()
// export async function save_game_history(params: {
//   roundId: string;
//   winnerId: string;
//   winnerUsername: string;
//   totalPot: number;
//   houseCut: number;
//   prize: number;
//   totalRounds: number;
//   hadSuddenDeath: boolean;
//   finalScores: { [playerId: string]: number };
//   phaseHistory: any[];
//   playerCount: number;
//   members: string[];
//   timestamp: number;
// }) {
//   try {
//     console.log(`[HISTORY] Saving game history: ${params.roundId}`);
//
//     const result = await CocobaseHelper.createGameHistory({
//       round_id: params.roundId,
//       game_type: "pipshot",
//       total_pot: params.totalPot,
//       house_cut: params.houseCut,
//       prize: params.prize,
//       winner_id: params.winnerId,
//       winner_username: params.winnerUsername,
//       total_rounds: params.totalRounds,
//       had_sudden_death: params.hadSuddenDeath,
//       final_scores: params.finalScores,
//       phase_history: params.phaseHistory,
//       player_count: params.playerCount,
//       members: params.members,
//       timestamp: params.timestamp,
//     });
//
//     console.log(`[HISTORY] Saved: ${result.id}`);
//   } catch (error) {
//     console.error(`[HISTORY] Error: ${error}`);
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
 *   - Returns immediately
 *   - Task runs in background worker pool
 *   - Includes retry logic and error handling
 *
 * Example usage in engine.ts:
 *   await CocobaseHelper.queue.add("process_winner_payout", { winnerId, prize });
 *   await CocobaseHelper.queue.add("save_game_history", { roundId, ... });
 *   await CocobaseHelper.queue.add("process_house_cut", { houseCut });
 *
 * Task registration:
 *   CocobaseHelper.queue.registerTask("process_winner_payout", process_winner_payout);
 *   CocobaseHelper.queue.registerTask("save_game_history", save_game_history);
 *   CocobaseHelper.queue.registerTask("process_house_cut", process_house_cut);
 */
