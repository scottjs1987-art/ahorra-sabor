import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { usePacks } from '../../hooks/usePacks';
import { PackCard } from '../../components/PackCard';

const CATEGORIAS = ['Todos', 'Panadería', 'Rotisería', 'Café', 'Restaurante', 'Verdulería'];

export function HomeScreen({ navigation }) {
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const { packs, loading } = usePacks(categoriaActiva);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titulo}>AhorraSabor 🌿</Text>
        <Text style={styles.subtitulo}>Packs frescos con hasta 70% de descuento</Text>
      </View>

      {/* Filtros por categoría */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIAS}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.filtrosContainer}
        renderItem={({ item }) => {
          const activo = (item === 'Todos' && !categoriaActiva) || item === categoriaActiva;
          return (
            <TouchableOpacity
              style={[styles.filtro, activo && styles.filtroActivo]}
              onPress={() => setCategoriaActiva(item === 'Todos' ? null : item)}
            >
              <Text style={[styles.filtroText, activo && styles.filtroTextActivo]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {loading ? (
        <ActivityIndicator size="large" color="#16A34A" style={styles.loader} />
      ) : packs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🛒</Text>
          <Text style={styles.emptyText}>No hay packs disponibles en este momento.</Text>
          <Text style={styles.emptySubtext}>Volvé más tarde o probá otra categoría.</Text>
        </View>
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PackCard
              pack={item}
              onPress={() => navigation.navigate('PackDetalle', { pack: item })}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#16A34A" />
          }
          contentContainerStyle={styles.lista}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  header: { backgroundColor: '#16A34A', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  titulo: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  subtitulo: { fontSize: 14, color: '#BBF7D0', marginTop: 4 },
  filtrosContainer: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filtro: {
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#E5E7EB', marginRight: 8,
  },
  filtroActivo: { backgroundColor: '#16A34A' },
  filtroText: { fontSize: 14, color: '#374151', fontWeight: '600' },
  filtroTextActivo: { color: '#FFF' },
  lista: { paddingBottom: 24 },
  loader: { marginTop: 80 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#374151', textAlign: 'center' },
  emptySubtext: { fontSize: 14, color: '#9CA3AF', marginTop: 6, textAlign: 'center' },
});
