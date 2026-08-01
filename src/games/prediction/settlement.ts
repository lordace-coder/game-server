// Pure settlement math for the prediction game.
//
// Winners share the losers' pooled stakes. The house takes an admin-defined
// percentage of the losers' pool first; the remainder is split among winners
// pro-rata to their stake. Winners also receive their own stake back. Coins
// are integers, so bonus shares are floored to never over-distribute.

export interface SettlementBet {
  id: string;
  user_id: string;
  option_index: number;
  amount: number;
}

export interface SettlementPayout {
  betId: string;
  userId: string;
  amount: number;
  payout: number;
  won: boolean;
  refunded: boolean;
}

export interface SettlementResult {
  totalPool: number;
  winnersStake: number;
  losersPool: number;
  houseCut: number;
  distributable: number;
  refunded: boolean;
  payouts: SettlementPayout[];
}

export function clampPercentage(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

export function computeSettlement(
  bets: SettlementBet[],
  winningOption: number,
  housePercentage: number
): SettlementResult {
  const pct = clampPercentage(housePercentage);
  const totalPool = bets.reduce((s, b) => s + b.amount, 0);
  const winners = bets.filter((b) => b.option_index === winningOption);
  const winnersStake = winners.reduce((s, b) => s + b.amount, 0);

  // No winners → refund everyone their stake, house takes nothing.
  if (winnersStake === 0) {
    return {
      totalPool,
      winnersStake: 0,
      losersPool: totalPool,
      houseCut: 0,
      distributable: 0,
      refunded: true,
      payouts: bets.map((b) => ({
        betId: b.id,
        userId: b.user_id,
        amount: b.amount,
        payout: b.amount,
        won: false,
        refunded: true,
      })),
    };
  }

  const losersPool = totalPool - winnersStake;
  const houseCut = Math.floor((losersPool * pct) / 100);
  const distributable = losersPool - houseCut;

  const payouts: SettlementPayout[] = bets.map((b) => {
    const won = b.option_index === winningOption;
    if (!won) {
      return {
        betId: b.id,
        userId: b.user_id,
        amount: b.amount,
        payout: 0,
        won: false,
        refunded: false,
      };
    }
    const bonus = Math.floor((distributable * b.amount) / winnersStake);
    return {
      betId: b.id,
      userId: b.user_id,
      amount: b.amount,
      payout: b.amount + bonus,
      won: true,
      refunded: false,
    };
  });

  return {
    totalPool,
    winnersStake,
    losersPool,
    houseCut,
    distributable,
    refunded: false,
    payouts,
  };
}
