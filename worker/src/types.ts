export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  MP_ACCESS_TOKEN: string;
  MP_WEBHOOK_SECRET: string;
  APP_BASE_URL: string;
  TAKE_RATE: string;
  PLATFORM_FEE_RATE: string;  // override dinámico del take rate
  QR_SIGNING_SECRET: string;
}

export interface Pack {
  id: string;
  merchant_id: string;
  title: string;
  description: string | null;
  price_reg: number;
  price_offer: number;
  stock: number;
  reserved_stock: number;
  end_time: string;
  status: 'active' | 'paused' | 'expired' | 'donated';
  image_url: string | null;
  category: string;
}

export interface Order {
  id: string;
  user_id: string;
  pack_id: string;
  merchant_id: string;
  status: 'pending' | 'paid' | 'delivered' | 'cancelled';
  quantity: number;
  total: number;
  platform_fee: number | null;
  net_merchant: number | null;
  mp_preference_id: string | null;
  mp_payment_id: string | null;
  mp_status: string | null;
  qr_token: string | null;
  qr_token_hash: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  // join
  packs?: Pick<Pack, 'title' | 'stock' | 'reserved_stock' | 'status'>;
}

export interface Profile {
  id: string;
  role: 'user' | 'merchant';
  name: string;
  geo_lat: number | null;
  geo_lng: number | null;
}

export interface MPPayment {
  id: number;
  status: string;
  external_reference: string;
  transaction_amount: number;
}

export interface MPPreference {
  id: string;
  init_point: string;
  sandbox_init_point: string;
}
