import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { formatARS, formatAhorro, formatHorario } from '../../utils/formatters';
import { createPaymentPreference } from '../../services/api';

export function PackDetailScreen({ route, navigation }) {
  const { pack } = route.params;
  const [cantidad, setCantidad] = useState(1);
  const [cargando, setCargando] = useState(false);
  const { ahorro, porcentaje } = formatAhorro(pack.precioOriginal, pack.precioDescuento);

  const total = pack.precioDescuento * cantidad;
  const ahorroTotal = pack.precioOriginal * cantidad - total;

  const handleComprar = async () => {
    setCargando(true);
    try {
      const { data } = await createPaymentPreference(pack.id, cantidad);
      const url = __DEV__ ? data.sandboxInitPoint : data.initPoint;
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert(
        'Error al iniciar el pago',
        err.response?.data?.error || 'Intentá de nuevo en unos minutos.',
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.categoria}>{pack.categoria}</Text>
        <Text style={styles.merchantNombre}>{pack.merchantNombre}</Text>
        <Text style={styles.packNombre}>{pack.nombre}</Text>
        {pack.descripcion && (
          <Text style={styles.descripcion}>{pack.descripcion}</Text>
        )}
      </View>

      {/* Precio y ahorro */}
      <View style={styles.seccion}>
        <View style={styles.precioRow}>
          <Text style={styles.precioFinal}>{formatARS(pack.precioDescuento)}</Text>
          <Text style={styles.precioTachado}>{formatARS(pack.precioOriginal)}</Text>
          <View style={styles.descuentoPill}>
            <Text style={styles.descuentoPillText}>{porcentaje}% OFF</Text>
          </View>
        </View>
        <View style={styles.ahorroBox}>
          <Text style={styles.ahorroTexto}>💰 Ahorrás {formatARS(ahorro)} por pack</Text>
        </View>
      </View>

      {/* Ventana de retiro */}
      <View style={styles.seccion}>
        <Text style={styles.seccionTitulo}>Ventana de Retiro</Text>
        <Text style={styles.horario}>
          🕐 {formatHorario(pack.ventanaRetiroDesde, pack.ventanaRetiroHasta)}
        </Text>
        <Text style={styles.direccion}>📍 {pack.merchantDireccion}</Text>
      </View>

      {/* Selector de cantidad */}
      <View style={styles.seccion}>
        <Text style={styles.seccionTitulo}>Cantidad</Text>
        <View style={styles.cantidadRow}>
          <TouchableOpacity
            style={styles.btnCantidad}
            onPress={() => setCantidad(Math.max(1, cantidad - 1))}
          >
            <Text style={styles.btnCantidadText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.cantidadNum}>{cantidad}</Text>
          <TouchableOpacity
            style={styles.btnCantidad}
            onPress={() => setCantidad(Math.min(pack.stockDisponible, cantidad + 1))}
          >
            <Text style={styles.btnCantidadText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.stockInfo}>({pack.stockDisponible} disponibles)</Text>
        </View>
      </View>

      {/* Resumen total */}
      <View style={styles.resumenBox}>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Total a pagar</Text>
          <Text style={styles.resumenTotal}>{formatARS(total)}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Tu ahorro total</Text>
          <Text style={styles.resumenAhorro}>{formatARS(ahorroTotal)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.btnComprar, cargando && styles.btnComprarDisabled]}
        onPress={handleComprar}
        disabled={cargando}
      >
        {cargando
          ? <ActivityIndicator color="#FFF" />
          : <Text style={styles.btnComprarText}>Pagar con Mercado Pago</Text>
        }
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        Al finalizar el pago recibirás un código QR para retirar tu pack.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  content: { padding: 20, paddingBottom: 40 },
  heroCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 2,
  },
  categoria: { fontSize: 12, fontWeight: '700', color: '#F97316', textTransform: 'uppercase', marginBottom: 4 },
  merchantNombre: { fontSize: 14, color: '#6B7280', marginBottom: 4 },
  packNombre: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8 },
  descripcion: { fontSize: 14, color: '#6B7280', lineHeight: 20 },
  seccion: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16,
    marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1,
  },
  seccionTitulo: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 10 },
  precioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  precioFinal: { fontSize: 28, fontWeight: '800', color: '#16A34A' },
  precioTachado: { fontSize: 16, color: '#9CA3AF', textDecorationLine: 'line-through' },
  descuentoPill: { backgroundColor: '#FEF9C3', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  descuentoPillText: { color: '#CA8A04', fontWeight: '700', fontSize: 13 },
  ahorroBox: { backgroundColor: '#ECFDF5', borderRadius: 10, padding: 10 },
  ahorroTexto: { color: '#059669', fontWeight: '700', fontSize: 14 },
  horario: { fontSize: 15, color: '#374151', marginBottom: 6 },
  direccion: { fontSize: 14, color: '#6B7280' },
  cantidadRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btnCantidad: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  btnCantidadText: { fontSize: 22, fontWeight: '700', color: '#374151' },
  cantidadNum: { fontSize: 22, fontWeight: '800', color: '#111827', minWidth: 32, textAlign: 'center' },
  stockInfo: { fontSize: 13, color: '#9CA3AF' },
  resumenBox: {
    backgroundColor: '#F0FDF4', borderRadius: 16, padding: 16,
    marginBottom: 20, borderWidth: 1, borderColor: '#BBF7D0',
  },
  resumenRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  resumenLabel: { fontSize: 15, color: '#374151' },
  resumenTotal: { fontSize: 18, fontWeight: '800', color: '#111827' },
  resumenAhorro: { fontSize: 16, fontWeight: '700', color: '#16A34A' },
  btnComprar: {
    backgroundColor: '#009EE3',
    borderRadius: 16, paddingVertical: 18,
    alignItems: 'center', marginBottom: 12,
  },
  btnComprarDisabled: { opacity: 0.6 },
  btnComprarText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  disclaimer: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },
});
