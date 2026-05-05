const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const formatARS = (amount) => ARS.format(amount);

export const formatAhorro = (original, descuento) => {
  const ahorro = original - descuento;
  const porcentaje = Math.round((ahorro / original) * 100);
  return { ahorro, porcentaje, textoAhorro: `Ahorrás ${formatARS(ahorro)} (${porcentaje}% OFF)` };
};

export const formatHorario = (desde, hasta) => {
  const f = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return `${f(desde)} – ${f(hasta)}`;
};

export const distanciaTexto = (metros) => {
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1)} km`;
};
