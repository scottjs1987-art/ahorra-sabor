import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { formatARS, formatAhorro, formatHorario, distanciaTexto } from '../utils/formatters';

const COLORES_CATEGORIA = {
  Panadería: '#F97316',
  Rotisería: '#EF4444',
  Café: '#92400E',
  Restaurante: '#7C3AED',
  Verdulería: '#16A34A',
};

export function PackCard({ pack, onPress }) {
  const { textoAhorro, porcentaje } = formatAhorro(pack.precioOriginal, pack.precioDescuento);
  const color = COLORES_CATEGORIA[pack.categoria] || '#16A34A';
  const stockBajo = pack.stockDisponible <= 2;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{pack.categoria}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.merchantName}>{pack.merchantNombre}</Text>
        <Text style={styles.packName} numberOfLines={2}>{pack.nombre}</Text>

        <View style={styles.row}>
          <Text style={styles.precioDescuento}>{formatARS(pack.precioDescuento)}</Text>
          <Text style={styles.precioOriginal}>{formatARS(pack.precioOriginal)}</Text>
          <View style={styles.descuentoBadge}>
            <Text style={styles.descuentoText}>{porcentaje}% OFF</Text>
          </View>
        </View>

        <Text style={styles.ahorro}>{textoAhorro}</Text>

        <View style={styles.footer}>
          <Text style={styles.horario}>
            🕐 Retiro: {formatHorario(pack.ventanaRetiroDesde, pack.ventanaRetiroHasta)}
          </Text>
          {pack.distanciaMetros != null && (
            <Text style={styles.distancia}>📍 {distanciaTexto(pack.distanciaMetros)}</Text>
          )}
        </View>

        {stockBajo && (
          <Text style={styles.stockAlerta}>
            ⚡ ¡Solo {pack.stockDisponible} {pack.stockDisponible === 1 ? 'pack' : 'packs'} disponibles!
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    borderBottomRightRadius: 12,
  },
  badgeText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  body: { padding: 16 },
  merchantName: { fontSize: 13, color: '#6B7280', marginBottom: 2 },
  packName: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  precioDescuento: { fontSize: 22, fontWeight: '800', color: '#16A34A' },
  precioOriginal: { fontSize: 15, color: '#9CA3AF', textDecorationLine: 'line-through' },
  descuentoBadge: { backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  descuentoText: { color: '#D97706', fontWeight: '700', fontSize: 13 },
  ahorro: { fontSize: 13, color: '#059669', fontWeight: '600', marginBottom: 10 },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  horario: { fontSize: 12, color: '#6B7280' },
  distancia: { fontSize: 12, color: '#6B7280' },
  stockAlerta: { marginTop: 8, fontSize: 13, color: '#DC2626', fontWeight: '700' },
});
