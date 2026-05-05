import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import * as Location from 'expo-location';
import { supabase } from '../../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

interface Pack {
  id: string;
  merchant_id: string;
  title: string;
  description: string | null;
  price_reg: number;
  price_offer: number;
  stock: number;
  reserved_stock: number;
  end_time: string;
  status: string;
  image_url: string | null;
  category: string;
  // enriquecidos
  merchant_name?: string;
  merchant_lat?: number;
  merchant_lng?: number;
  distanceM?: number;
}

const CATEGORIAS = ['Todos', 'Panadería', 'Rotisería', 'Café', 'Restaurante', 'Verdulería'];

// ─────────────────────────────────────────────────────────────
// Haversine — distancia en metros entre dos coordenadas
// ─────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function discountPct(reg: number, offer: number): number {
  return Math.round((1 - offer / reg) * 100);
}

// ─────────────────────────────────────────────────────────────
// PackCard — componente individual con NativeWind
// ─────────────────────────────────────────────────────────────

function PackCard({ pack, onPress }: { pack: Pack; onPress: () => void }) {
  const pct = discountPct(pack.price_reg, pack.price_offer);
  const freeStock = pack.stock - pack.reserved_stock;
  const stockLow = freeStock <= 2;

  // Animación de parpadeo si stock = 1
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (freeStock <= 1) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      ).start();
    }
  }, [freeStock]);

  return (
    <TouchableOpacity
      className="bg-white mx-4 my-2 rounded-2xl overflow-hidden"
      style={{ elevation: 3, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Banda de categoría */}
      <View className={`px-3 py-1 self-start ${categoryBg(pack.category)}`}>
        <Text className="text-white text-xs font-bold">{pack.category}</Text>
      </View>

      <View className="p-4">
        <Text className="text-gray-500 text-xs mb-0.5">{pack.merchant_name}</Text>
        <Text className="text-gray-900 text-lg font-black mb-2" numberOfLines={2}>
          {pack.title}
        </Text>

        {/* Precios */}
        <View className="flex-row items-center gap-2 mb-1">
          <Text className="text-green-brand text-2xl font-black">{fmtARS(pack.price_offer)}</Text>
          <Text className="text-gray-400 text-sm line-through">{fmtARS(pack.price_reg)}</Text>
          <View className="bg-yellow-100 rounded-lg px-2 py-0.5">
            <Text className="text-yellow-700 font-bold text-xs">{pct}% OFF</Text>
          </View>
        </View>

        <Text className="text-emerald-600 font-semibold text-xs mb-3">
          💰 Ahorrás {fmtARS(pack.price_reg - pack.price_offer)}
        </Text>

        {/* Footer */}
        <View className="flex-row justify-between items-center">
          <Text className="text-gray-400 text-xs">
            🕐 Hasta {new Date(pack.end_time).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
          </Text>
          {pack.distanceM != null && (
            <Text className="text-gray-400 text-xs">📍 {fmtDistance(pack.distanceM)}</Text>
          )}
        </View>

        {/* Alerta de stock bajo */}
        {stockLow && (
          <Animated.Text
            style={{ opacity: freeStock <= 1 ? blink : 1 }}
            className="text-red-600 font-bold text-xs mt-2"
          >
            ⚡ ¡Solo {freeStock} {freeStock === 1 ? 'pack' : 'packs'}!
          </Animated.Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function categoryBg(cat: string): string {
  const map: Record<string, string> = {
    Panadería: 'bg-orange-brand',
    Rotisería: 'bg-red-500',
    Café: 'bg-amber-800',
    Restaurante: 'bg-violet-700',
    Verdulería: 'bg-green-brand',
  };
  return map[cat] ?? 'bg-green-brand';
}

// ─────────────────────────────────────────────────────────────
// HomeScreen
// ─────────────────────────────────────────────────────────────

export function HomeScreen({ navigation }: { navigation: any }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Obtener ubicación del usuario
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();
  }, []);

  const loadPacks = useCallback(async () => {
    const now = new Date().toISOString();
    let q = supabase
      .from('packs')
      .select(`
        id, merchant_id, title, description, price_reg, price_offer,
        stock, reserved_stock, end_time, status, image_url, category,
        profiles!merchant_id ( name, geo_lat, geo_lng )
      `)
      .eq('status', 'active')
      .gt('end_time', now)
      .gt('stock', 0);

    if (categoria) q = q.eq('category', categoria);

    const { data, error } = await q;
    if (error) { console.error('[HomeScreen] loadPacks:', error); return; }

    const enriched: Pack[] = (data ?? []).map((row: any) => {
      const profile = row.profiles;
      const distanceM =
        userCoords && profile?.geo_lat && profile?.geo_lng
          ? haversineM(userCoords.lat, userCoords.lng, profile.geo_lat, profile.geo_lng)
          : undefined;
      return {
        ...row,
        merchant_name: profile?.name,
        merchant_lat: profile?.geo_lat,
        merchant_lng: profile?.geo_lng,
        distanceM,
      };
    });

    // Ordenar por distancia (nulls al final), luego por hora de cierre
    enriched.sort((a, b) => {
      if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
      if (a.distanceM != null) return -1;
      if (b.distanceM != null) return 1;
      return new Date(a.end_time).getTime() - new Date(b.end_time).getTime();
    });

    setPacks(enriched);
  }, [categoria, userCoords]);

  // Carga inicial y recarga ante cambios de filtro/coords
  useEffect(() => {
    setLoading(true);
    loadPacks().finally(() => setLoading(false));
  }, [loadPacks]);

  // Supabase Realtime — actualización instantánea de stock
  useEffect(() => {
    channelRef.current?.unsubscribe();

    channelRef.current = supabase
      .channel('packs-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'packs' },
        (payload) => {
          const updated = payload.new as Partial<Pack> & { id: string };
          setPacks((prev) =>
            prev
              .map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
              // Quitar packs agotados o expirados en tiempo real
              .filter((p) => p.status === 'active' && p.stock - p.reserved_stock > 0),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'packs' },
        () => { loadPacks(); },
      )
      .subscribe();

    return () => { channelRef.current?.unsubscribe(); };
  }, [loadPacks]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPacks();
    setRefreshing(false);
  }, [loadPacks]);

  return (
    <View className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-green-brand pt-14 pb-5 px-5">
        <Text className="text-white text-2xl font-black">AhorraSabor 🌿</Text>
        <Text className="text-green-muted text-sm mt-1">
          Packs frescos con hasta 70% de descuento
        </Text>
      </View>

      {/* Filtros */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIAS}
        keyExtractor={(i) => i}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
        renderItem={({ item }) => {
          const active = item === 'Todos' ? !categoria : categoria === item;
          return (
            <TouchableOpacity
              className={`rounded-full px-4 py-2 mr-2 ${active ? 'bg-green-brand' : 'bg-gray-200'}`}
              onPress={() => setCategoria(item === 'Todos' ? null : item)}
            >
              <Text className={`font-semibold text-sm ${active ? 'text-white' : 'text-gray-700'}`}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Lista */}
      {loading ? (
        <ActivityIndicator size="large" color="#16A34A" className="mt-20" />
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PackCard
              pack={item}
              onPress={() => navigation.navigate('PackDetalle', { pack: item })}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#16A34A" />
          }
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View className="items-center justify-center mt-20 px-8">
              <Text className="text-4xl mb-3">🛒</Text>
              <Text className="text-gray-800 text-base font-bold text-center">
                No hay packs disponibles ahora.
              </Text>
              <Text className="text-gray-400 text-sm text-center mt-1">
                Volvé más tarde o probá otra categoría.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
