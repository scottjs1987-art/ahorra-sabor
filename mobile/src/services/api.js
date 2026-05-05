import axios from 'axios';
import { auth } from './firebase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

const api = axios.create({ baseURL: BASE_URL, timeout: 10000 });

api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const createPaymentPreference = (packId, quantity = 1) =>
  api.post('/payments/create-preference', {
    packId,
    userId: auth.currentUser?.email,
    quantity,
  });

export const validatePickupQR = (qrCode, merchantId) =>
  api.post('/payments/validate-pickup', { qrCode, merchantId });

export const notifyDonation = (packId, merchantId, cantidadExcedente, descripcion) =>
  api.post('/donations/notify', { packId, merchantId, cantidadExcedente, descripcion });

export default api;
