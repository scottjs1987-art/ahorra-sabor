import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useCollection } from '../../../hooks/useCollection';
import { db, auth } from '../../services/firebase';
import { formatARS } from '../../utils/formatters';

const ESTADO_INFO = {
  pendiente:  { color: '#D97706', emoji: '⏳', label: 'Pendiente de pago' },
  aprobado:   { color: '#16A34A', emoji: '✅', label: 'Aprobado — mostrá el QR' },
  entregado:  { color: '#6B7280', emoji: '📦', label: 'Entregado' },
  rechazado:  { color: '#DC2626', emoji: '❌', label: 'Pago rechazado' },
  cancelado:  { color: '#9CA3AF', emoji: '🚫', label: 'Cancelado' },
};

function OrderCard({ order }) {
  const info = ESTADO_INFO[order.estado] || ESTADO_INFO.pendiente;

  return (
    <View style={styles.card}>
      <View style={[styles.estadoBar, { backgroundColor: info.color }]}>
        <Text style={styles.estadoBarText}>{info.emoji} {info.label}</Text>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.orderId}>Orden #{order.id.slice(0, 8).toUpperCase()}</Text>
        <Text style={styles.total}>Total: {formatARS(order.totalAbonado)}</Text>
        <Text style={styles.fecha}>
          {new Date(order.creadoEn).toLocaleDateString('es-AR', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          })}
        </Text>

        {order.estado === 'aprobado' && order.qrCode && (
          <View style={styles.qrContainer}>
            <QRCode value={order.qrCode} size={180} color="#111827" backgroundColor="#FFF" />
            <Text style={styles.qrCodigo}>{order.qrCode}</Text>
            <Text style={styles.qrInstruccion}>
              Mostrá este código al comercio para retirar tu pack
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function MyOrdersScreen() {
  const userId = auth.currentUser?.email;
  const q = query(
    collection(db, 'orders'),
    where('userId', '==', userId),
    orderBy('creadoEn', 'desc'),
  );

  const { data: orders, loading } = useCollection(q);

  if (loading) return <ActivityIndicator size="large" color="#16A34A" style={{ marginTop: 80 }} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titulo}>Mis Compras</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.lista}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTexto}>Todavía no compraste ningún pack.{'\n'}¡Empezá a ahorrar!</Text>
          </View>
        }
        renderItem={({ item }) => <OrderCard order={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  header: { backgroundColor: '#16A34A', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  titulo: { fontSize: 24, fontWeight: '800', color: '#FFF' },
  lista: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, marginBottom: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  estadoBar: { paddingHorizontal: 16, paddingVertical: 10 },
  estadoBarText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  cardBody: { padding: 16 },
  orderId: { fontSize: 13, color: '#6B7280', marginBottom: 4 },
  total: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 4 },
  fecha: { fontSize: 13, color: '#9CA3AF', marginBottom: 16, textTransform: 'capitalize' },
  qrContainer: { alignItems: 'center', padding: 20, backgroundColor: '#F9FAF9', borderRadius: 12 },
  qrCodigo: { marginTop: 12, fontSize: 16, fontWeight: '800', color: '#374151', letterSpacing: 2 },
  qrInstruccion: { marginTop: 8, fontSize: 13, color: '#6B7280', textAlign: 'center' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyTexto: { fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
});
