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
