export interface Wallet {
  usdt: number;
  coins_balance: number;
  user_id: string;
  user?: any;
}

export interface UserData {
  name: string;
  picture: string;
  username: string;
  given_name: string;
  family_name: string;
}

export type PredictionStatus = "open" | "closed" | "resolved";
export type PredictionBetStatus = "active" | "won" | "lost" | "refunded";

export interface Prediction {
  title: string;
  description: string;
  options: string[];
  house_percentage: number;
  status: PredictionStatus;
  winning_option: number | null;
  closes_at: string | null;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  house_collected: number;
  total_pool: number;
}

export interface PredictionBet {
  prediction_id: string;
  user_id: string;
  option_index: number;
  amount: number;
  status: PredictionBetStatus;
  payout: number;
  created_at: string;
  settled_at: string | null;
}
