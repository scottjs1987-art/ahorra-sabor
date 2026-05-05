const { Preference, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const mpClient = require('../config/mercadopago');
const { db } = require('../config/firebase');

const TAKE_RATE = parseFloat(process.env.TAKE_RATE || '0.15');

/**
 * Crea una preferencia de Checkout Pro para un pack sorpresa.
 * Retorna la URL de pago y el ID de preferencia.
 */
async function createPreference({ packId, userId, quantity = 1 }) {
  const packDoc = await db.collection('packs').doc(packId).get();
  if (!packDoc.exists) throw new Error('Pack no encontrado');

  const pack = packDoc.data();
  if (pack.stockDisponible < quantity) throw new Error('Stock insuficiente');

  const merchantDoc = await db.collection('merchants').doc(pack.merchantId).get();
  const merchant = merchantDoc.data();

  const externalReference = uuidv4();
  const unitPrice = Math.round(pack.precioDescuento * 100) / 100;

  const preference = new Preference(mpClient);
  const response = await preference.create({
    body: {
      items: [
        {
          id: packId,
          title: `Pack Sorpresa — ${merchant.nombre}`,
          description: pack.descripcion || 'Pack con productos frescos con descuento',
          quantity,
          unit_price: unitPrice,
          currency_id: 'ARS',
          category_id: 'food',
        },
      ],
      payer: {
        email: userId,
      },
      back_urls: {
        success: `${process.env.APP_BASE_URL}/pago/exito`,
        failure: `${process.env.APP_BASE_URL}/pago/fallo`,
        pending: `${process.env.APP_BASE_URL}/pago/pendiente`,
      },
      auto_return: 'approved',
      external_reference: externalReference,
      notification_url: `${process.env.APP_BASE_URL}/api/webhooks/mercadopago`,
      statement_descriptor: 'AHORRASABOR',
      expires: true,
      expiration_date_to: pack.ventanaRetiroHasta,
    },
  });

  // Reserva de stock y orden pendiente en Firestore
  const batch = db.batch();

  const orderRef = db.collection('orders').doc(externalReference);
  batch.set(orderRef, {
    id: externalReference,
    packId,
    merchantId: pack.merchantId,
    userId,
    quantity,
    precioUnitario: unitPrice,
    totalAbonado: unitPrice * quantity,
    platformFee: Math.round(unitPrice * quantity * TAKE_RATE * 100) / 100,
    liquidacionMerchant: Math.round(unitPrice * quantity * (1 - TAKE_RATE) * 100) / 100,
    estado: 'pendiente',
    mpPreferenceId: response.id,
    qrCode: null,
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  });

  // Reserva temporal de stock
  const packRef = db.collection('packs').doc(packId);
  batch.update(packRef, {
    stockReservado: (pack.stockReservado || 0) + quantity,
  });

  await batch.commit();

  return {
    preferenceId: response.id,
    initPoint: response.init_point,
    sandboxInitPoint: response.sandbox_init_point,
    externalReference,
  };
}

/**
 * Procesa la notificación de Mercado Pago.
 * Actualiza la orden, libera/consume stock y calcula la liquidación.
 */
async function processWebhookPayment(paymentId) {
  const paymentClient = new Payment(mpClient);
  const payment = await paymentClient.get({ id: paymentId });

  const externalReference = payment.external_reference;
  if (!externalReference) return;

  const orderRef = db.collection('orders').doc(externalReference);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) return;

  const order = orderDoc.data();
  const status = payment.status;

  if (status === 'approved') {
    const qrCode = `AS-${externalReference.slice(0, 8).toUpperCase()}`;

    const batch = db.batch();

    // Aprueba la orden y genera el código QR
    batch.update(orderRef, {
      estado: 'aprobado',
      mpPaymentId: String(paymentId),
      mpStatus: status,
      qrCode,
      actualizadoEn: new Date().toISOString(),
    });

    // Consume stock definitivamente
    const packRef = db.collection('packs').doc(order.packId);
    const packDoc = await packRef.get();
    const pack = packDoc.data();
    batch.update(packRef, {
      stockDisponible: pack.stockDisponible - order.quantity,
      stockReservado: Math.max((pack.stockReservado || 0) - order.quantity, 0),
    });

    // Registra la liquidación pendiente al comercio
    const liquidacionRef = db.collection('liquidaciones').doc();
    batch.set(liquidacionRef, {
      merchantId: order.merchantId,
      orderId: externalReference,
      bruto: order.totalAbonado,
      platformFee: order.platformFee,
      neto: order.liquidacionMerchant,
      estado: 'pendiente_pago',
      creadoEn: new Date().toISOString(),
    });

    await batch.commit();

  } else if (['rejected', 'cancelled'].includes(status)) {
    const batch = db.batch();

    batch.update(orderRef, {
      estado: status === 'rejected' ? 'rechazado' : 'cancelado',
      mpPaymentId: String(paymentId),
      mpStatus: status,
      actualizadoEn: new Date().toISOString(),
    });

    // Libera stock reservado
    const packRef = db.collection('packs').doc(order.packId);
    const packDoc = await packRef.get();
    const pack = packDoc.data();
    batch.update(packRef, {
      stockReservado: Math.max((pack.stockReservado || 0) - order.quantity, 0),
    });

    await batch.commit();
  }
}

/**
 * Valida el QR en el local y marca la orden como entregada.
 */
async function validatePickup({ qrCode, merchantId }) {
  const snapshot = await db.collection('orders')
    .where('qrCode', '==', qrCode)
    .where('merchantId', '==', merchantId)
    .where('estado', '==', 'aprobado')
    .limit(1)
    .get();

  if (snapshot.empty) throw new Error('QR inválido o ya utilizado');

  const orderDoc = snapshot.docs[0];
  await orderDoc.ref.update({
    estado: 'entregado',
    entregadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  });

  // Marca la liquidación como lista para pagar
  await db.collection('liquidaciones')
    .where('orderId', '==', orderDoc.id)
    .get()
    .then(snap => {
      const batch = db.batch();
      snap.forEach(doc => batch.update(doc.ref, { estado: 'listo_para_pagar' }));
      return batch.commit();
    });

  return orderDoc.data();
}

module.exports = { createPreference, processWebhookPayment, validatePickup };
