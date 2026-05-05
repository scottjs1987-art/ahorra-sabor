# AhorraSabor — Esquema de Base de Datos (Firestore)

## Colecciones

---

### `users/{userId}`
```
{
  uid: string,                  // Firebase Auth UID
  email: string,
  nombre: string,
  apellido: string,
  isMerchant: boolean,          // false = comprador, true = comercio
  fcmToken: string | null,      // Para push notifications
  creadoEn: timestamp,
  actualizadoEn: timestamp,
}
```

---

### `merchants/{merchantId}`
```
{
  uid: string,                  // === userId del dueño
  nombre: string,               // "Panadería Don Julio"
  categoria: string,            // "Panadería" | "Rotisería" | "Café" | ...
  descripcion: string,
  direccion: string,
  lat: number,
  lon: number,
  telefono: string,
  mpAccessToken: string,        // Token de MP del comercio (Marketplace futuro)
  creadoEn: timestamp,
  actualizadoEn: timestamp,
}
```

---

### `packs/{packId}`
```
{
  merchantId: string,           // ref → merchants/{id}
  merchantNombre: string,       // desnormalizado para queries rápidas
  merchantDireccion: string,
  merchantLat: number,
  merchantLon: number,
  nombre: string,               // "Pack del día - Medialunas"
  descripcion: string,
  categoria: string,
  precioOriginal: number,       // ARS
  precioDescuento: number,      // ARS (≥30% de descuento obligatorio)
  stockDisponible: number,
  stockReservado: number,       // Reservas pendientes de pago
  ventanaRetiroDesde: string,   // ISO 8601
  ventanaRetiroHasta: string,   // ISO 8601 — índice para expiración
  expiraAutomatico: boolean,
  activo: boolean,
  donado: boolean,
  creadoEn: timestamp,
  actualizadoEn: timestamp,
}
```
**Índices compuestos requeridos:**
- `(activo ASC, stockDisponible ASC, ventanaRetiroHasta ASC)`
- `(categoria ASC, activo ASC, ventanaRetiroHasta ASC)`
- `(merchantId ASC, creadoEn DESC)`

---

### `orders/{externalReference}`
```
{
  id: string,                   // UUID v4 = externalReference de MP
  packId: string,
  merchantId: string,
  userId: string,               // email del comprador
  quantity: number,
  precioUnitario: number,
  totalAbonado: number,
  platformFee: number,          // 15% de totalAbonado
  liquidacionMerchant: number,  // 85% de totalAbonado
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado" | "entregado",
  mpPreferenceId: string,
  mpPaymentId: string | null,
  mpStatus: string | null,
  qrCode: string | null,        // Ej: "AS-A1B2C3D4" — se genera al aprobar
  entregadoEn: string | null,
  creadoEn: string,             // ISO 8601
  actualizadoEn: string,
}
```
**Índices:**
- `(userId ASC, creadoEn DESC)`
- `(merchantId ASC, estado ASC)`
- `(qrCode ASC, merchantId ASC, estado ASC)` → para validación de pick-up

---

### `liquidaciones/{liquidacionId}`
```
{
  merchantId: string,
  orderId: string,
  bruto: number,
  platformFee: number,          // 15%
  neto: number,                 // 85%
  estado: "pendiente_pago" | "listo_para_pagar" | "pagado",
  creadoEn: string,
  pagadoEn: string | null,
}
```
**Índice:** `(merchantId ASC, estado ASC)`

---

### `donations/{donationId}`
```
{
  evento: "excedente_disponible",
  comercio: {
    id: string,
    nombre: string,
    direccion: string,
  },
  excedente: {
    packId: string,
    cantidad: number,
    descripcion: string,
    disponibleHasta: string,
  },
  estado: "notificado" | "reclamado",
  timestamp: string,
}
```

---

## Reglas de Seguridad Firestore (resumen)

```
// packs: lectura pública, escritura solo del merchant dueño
match /packs/{packId} {
  allow read: if true;
  allow write: if request.auth.uid == resource.data.merchantId;
  allow create: if request.auth != null;
}

// orders: lectura del comprador o del merchant involucrado
match /orders/{orderId} {
  allow read: if request.auth.token.email == resource.data.userId
    || request.auth.uid == resource.data.merchantId;
  allow create: if request.auth != null;
  allow update: if false; // solo el backend con Admin SDK
}

// merchants: lectura pública, escritura solo del dueño
match /merchants/{merchantId} {
  allow read: if true;
  allow write: if request.auth.uid == merchantId;
}
```

---

## Flujo de Dinero — Take Rate 15%

```
Comprador paga $1000 (Mercado Pago Checkout Pro)
     │
     ▼
Webhook payment.created → estado: "aprobado"
     │
     ├── Platform Fee:     $150  (15%)  → AhorraSabor
     └── Liquidación:      $850  (85%)  → Comercio

Pick-up validado (QR escaneado) → liquidacion.estado = "listo_para_pagar"
     │
     ▼
Proceso de pago manual/automático a cuenta MP del comercio
```
