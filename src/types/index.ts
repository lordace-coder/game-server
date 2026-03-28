export interface Player {
    userId: string;
    stake: number;
    cashedOut: boolean;
    payout: number;
    walletBalance: number; // The cached balance
}

export interface GameResult {
    roundId: string;
    multiplier: number;
    results: Record<string, any>;
}