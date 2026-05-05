import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { notifyDonation } from '../../services/api';
import { useMerchantPacks } from '../../hooks/usePacks';
import { formatARS, formatHorario } from '../../utils/formatters';
import { auth } from '../../services/firebase';

const ESTADO_COLORES = {
  activo: '#16A34A',
  pausado: '#D97706',
  expirado: '#6B7280',
  agotado: '#DC2626',
};

export function DashboardScreen({ navigation }) {
  const merchantId = auth.currentUser?.uid;
  const { packs, loading } = useMerchantPacks(merchantId);
  const [accionando, setAccionando] = useState(null);

  const togglePack = async (pack) => {
    setAccionando(pack.id);
    try {
      await updateDoc(doc(db, 'packs', pack.id), {
        activo: !pack.activo,
        actualizadoEn: serverTimestamp(),
      });
    } finally {
      setAccionando(null);
    }
  };

  const donarExcedente = async (pack) => {
    Alert.alert(
      'Donar Excedente',
      `¿Querés notificar a la ONG sobre los ${pack.stockDisponible} packs excedentes de "${pack.nombre}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, donar',
          onPress: async () => {
            setAccionando(pack.id);
            try {
              await notifyDonation(pack.id, merchantId, pack.stockDisponible, pack.nombre);
              await updateDoc(doc(db, 'packs', pack.id), {
                activo: false,
                donado: true,
                actualizadoEn: serverTimestamp(),
              });
              Alert.alert('¡Gracias!', 'La ONG fue notificada del excedente disponible.');
            } catch {
              Alert.alert('Error', 'No se pudo notificar a la ONG. Intentá de nuevo.');
            } finally {
              setAccionando(null);
            }
          },
        },
      ],
    );
  };

  const estadoPack = (pack) => {
    if (pack.donado) return 'donado';
    if (!pack.activo) return 'pausado';
    if (pack.stockDisponible <= 0) return 'agotado';
    if (new Date(pack.ventanaRetiroHasta) < new Date()) return 'expirado';
    return 'activo';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titulo}>Panel del Comercio</Text>
        <TouchableOpacity
          style={styles.btnNuevo}
          onPress={() => navigation.navigate('PublicarPack')}
        >
          <Text style={styles.btnNuevoText}>+ Nuevo Pack</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#16A34A" style={styles.loader} />
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.lista}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTexto}>
                Aún no publicaste ningún pack.{'\n'}¡Empezá ahora!
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const estado = estadoPack(item);
            const isLoading = accionando === item.id;
            return (
              <View style={styles.packCard}>
                <View style={styles.packTop}>
                  <Text style={styles.packNombre}>{item.nombre}</Text>
                  <View style={[styles.estadoBadge, { backgroundColor: ESTADO_COLORES[estado] || '#6B7280' }]}>
                    <Text style={styles.estadoText}>{estado}</Text>
                  </View>
                </View>

                <View style={styles.packInfo}>
                  <Text style={styles.infoItem}>💰 {formatARS(item.precioDescuento)} (era {formatARS(item.precioOriginal)})</Text>
                  <Text style={styles.infoItem}>📦 Stock: {item.stockDisponible} unidades</Text>
                  <Text style={styles.infoItem}>🕐 {formatHorario(item.ventanaRetiroDesde, item.ventanaRetiroHasta)}</Text>
                </View>

                <View style={styles.packAcciones}>
                  <TouchableOpacity
                    style={[styles.btnAccion, { backgroundColor: item.activo ? '#FEE2E2' : '#DCFCE7' }]}
                    onPress={() => togglePack(item)}
                    disabled={isLoading}
                  >
                    <Text style={{ color: item.activo ? '#DC2626' : '#16A34A', fontWeight: '700' }}>
                      {isLoading ? '...' : item.activo ? 'Pausar' : 'Activar'}
                    </Text>
                  </TouchableOpacity>

                  {estado === 'activo' && (
                    <TouchableOpacity
                      style={[styles.btnAccion, { backgroundColor: '#FEF9C3' }]}
                      onPress={() => donarExcedente(item)}
                      disabled={isLoading}
                    >
                      <Text style={{ color: '#CA8A04', fontWeight: '700' }}>🤝 Donar excedente</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      <TouchableOpacity
        style={styles.btnEscanear}
        onPress={() => navigation.navigate('EscanearQR')}
      >
        <Text style={styles.btnEscanearText}>📷 Validar Pick-up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  header: {
    backgroundColor: '#F97316', paddingTop: 56, paddingBottom: 20,
    paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  titulo: { fontSize: 24, fontWeight: '800', color: '#FFF' },
  btnNuevo: { backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  btnNuevoText: { color: '#F97316', fontWeight: '800', fontSize: 14 },
  loader: { marginTop: 80 },
  lista: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyTexto: { fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
  packCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  packTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  packNombre: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1 },
  estadoBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  estadoText: { color: '#FFF', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  packInfo: { gap: 4, marginBottom: 12 },
  infoItem: { fontSize: 13, color: '#6B7280' },
  packAcciones: { flexDirection: 'row', gap: 8 },
  btnAccion: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnEscanear: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: '#111827', borderRadius: 16, paddingVertical: 18,
    alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  btnEscanearText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});
