import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import axios from 'axios';
import { supabase } from './supabase';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL!;
const APP_SCHEME = 'ahorrasabor';

export type PaymentStatus = 'success' | 'failure' | 'pending' | 'cancelled';

export interface CheckoutResult {
  orderId: string;
  preferenceId: string;
  initPoint: string;
  sandboxInitPoint: string;
}

export interface PaymentResult {
  status: PaymentStatus;
  orderId?: string;
}

/**
 * Crea la preferencia en el Worker y devuelve los URLs de MP.
 */
export async function createCheckout(
  packId: string,
  quantity = 1,
): Promise<CheckoutResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.email;

  if (!userId) throw new Error('Necesitás iniciar sesión para comprar');

  const { data } = await axios.post<CheckoutResult>(
    `${WORKER_URL}/checkout`,
    { pack_id: packId, user_id: userId, quantity },
    {
      headers: {
        Authorization: `Bearer ${sessionData.session?.access_token}`,
        'Content-Type': 'application/json',
      },
      timeout: 12_000,
    },
  );

  return data;
}

/**
 * Abre Mercado Pago en un browser in-app y espera el deep link de retorno.
 * Retorna el estado final del pago.
 */
export async function openMercadoPago(checkout: CheckoutResult): Promise<PaymentResult> {
  const returnUrl = Linking.createURL('pago');
  const url = __DEV__ ? checkout.sandboxInitPoint : checkout.initPoint;

  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { status: 'cancelled', orderId: checkout.orderId };
  }

  if (result.type === 'success') {
    const parsed = Linking.parse(result.url);
    // MP agrega query params: ?collection_status=approved | rejected | pending
    const collectionStatus = parsed.queryParams?.['collection_status'] as string | undefined;
    const status = mpStatusToLocal(collectionStatus);
    return { status, orderId: checkout.orderId };
  }

  return { status: 'pending', orderId: checkout.orderId };
}

/**
 * Flujo completo: crear preferencia + abrir MP.
 */
export async function startPayment(
  packId: string,
  quantity = 1,
): Promise<PaymentResult> {
  const checkout = await createCheckout(packId, quantity);
  return openMercadoPago(checkout);
}

function mpStatusToLocal(mpStatus?: string): PaymentStatus {
  switch (mpStatus) {
    case 'approved':
      return 'success';
    case 'rejected':
    case 'null':
      return 'failure';
    case 'pending':
    case 'in_process':
      return 'pending';
    default:
      return 'pending';
  }
}
