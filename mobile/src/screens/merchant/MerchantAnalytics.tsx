import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Animated,
} from 'react-native';
import { supabase } from '../../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL!;

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

interface MerchantStats {
  merchant_id:       string;
  total_revenue:     number;
  total_orders:      number;
  total_packs_saved: number;
  total_saved_kg:    number;
  customer_rating:   number;
  rating_count:      number;
  pending_payout:    number;
  last_payout_at:    string | null;
}

interface HourBucket { label: string; count: number; revenue: number }

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const fmtShort = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `$${(n / 1_000).toFixed(1)}k`
  : fmt(n);

const stars = (rating: number) => {
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
};

// ─────────────────────────────────────────────────────────────
// Sub-componente: Tarjeta de métrica
// ─────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, sub, accent = '#16A34A',
}: {
  icon: string; label: string; value: string; sub?: string; accent?: string;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;

  // Animación de pulso cuando el valor cambia
  useEffect(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 200, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 200, useNativeDriver: true }),
    ]).start();
  }, [value]);

  return (
    <Animated.View
      style={{ transform: [{ scale }], flex: 1 }}
      className="bg-white rounded-2xl p-4 m-1"
      // @ts-ignore — shadow cross-platform
      style={{
        flex: 1, margin: 6, backgroundColor: '#fff', borderRadius: 20, padding: 16,
        shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
        elevation: 3, transform: [{ scale }],
      }}
    >
      <Text style={{ fontSize: 28, marginBottom: 6 }}>{icon}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: sub ? 2 : 0 }}>
        {value}
      </Text>
      {sub && <Text style={{ fontSize: 12, color: accent, fontWeight: '600' }}>{sub}</Text>}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-componente: Gráfico de barras horarias (SVG-free)
// ─────────────────────────────────────────────────────────────

function HourChart({ buckets }: { buckets: HourBucket[] }) {
  const max = Math.max(...buckets.map(b => b.count), 1);

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 16, margin: 6, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 }}>
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827', marginBottom: 4 }}>
        📊 Ventas por franja horaria
      </Text>
      <Text style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
        Optimizá tus publicaciones según la demanda
      </Text>

      {/* Barras */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 80, marginBottom: 8 }}>
        {buckets.map((b, i) => {
          const height = max > 0 ? Math.max((b.count / max) * 72, 4) : 4;
          const isTop  = b.count === max && max > 0;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              {isTop && (
                <Text style={{ fontSize: 9, color: '#f97316', fontWeight: '800', marginBottom: 2 }}>
                  PICO
                </Text>
              )}
              <View
                style={{
                  width: '100%', height, borderRadius: 6,
                  backgroundColor: isTop ? '#f97316' : b.count > 0 ? '#86efac' : '#f3f4f6',
                }}
              />
            </View>
          );
        })}
      </View>

      {/* Labels */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {buckets.map((b, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, color: '#6b7280', fontWeight: '600' }}>{b.label}</Text>
            <Text style={{ fontSize: 9, color: '#9ca3af' }}>{b.count > 0 ? `${b.count}v` : '-'}</Text>
          </View>
        ))}
      </View>

      {/* Insight automático */}
      {max > 0 && (() => {
        const topBucket = buckets.find(b => b.count === max)!;
        return (
          <View style={{ backgroundColor: '#fff7ed', borderRadius: 12, padding: 10, marginTop: 12 }}>
            <Text style={{ fontSize: 12, color: '#9a3412', fontWeight: '700' }}>
              💡 Publicá más packs en el turno {topBucket.label}: es tu franja de mayor demanda.
            </Text>
          </View>
        );
      })()}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-componente: Ledger — últimas transacciones
// ─────────────────────────────────────────────────────────────

function LedgerList({ merchantId }: { merchantId: string }) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from('financial_ledger')
      .select('total_amount, platform_fee, merchant_net, status, created_at')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setItems(data ?? []));
  }, [merchantId]);

  if (!items.length) return null;

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 16, margin: 6, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 }}>
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827', marginBottom: 12 }}>
        💳 Últimas liquidaciones
      </Text>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#f3f4f6' }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }}>
              {fmt(item.merchant_net)}
            </Text>
            <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
              {new Date(item.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ backgroundColor: item.status === 'paid_to_merchant' ? '#dcfce7' : '#fef9c3', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: item.status === 'paid_to_merchant' ? '#16A34A' : '#ca8a04' }}>
                {item.status === 'paid_to_merchant' ? 'Acreditado' : 'Pendiente'}
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: '#d1d5db', marginTop: 2 }}>
              fee: {fmt(item.platform_fee)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// MerchantAnalytics — pantalla principal
// ─────────────────────────────────────────────────────────────

export function MerchantAnalytics({ navigation }: { navigation: any }) {
  const [stats,        setStats]        = useState<MerchantStats | null>(null);
  const [buckets,      setBuckets]      = useState<HourBucket[]>([]);
  const [merchantId,   setMerchantId]   = useState<string>('');
  const [authLoading,  setAuthLoading]  = useState(true);
  const [loading,      setLoading]      = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const channelRef = React.useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMerchantId(data.user?.id ?? '');
      setAuthLoading(false);
    });
  }, []);

  // ── Cargar estadísticas y órdenes históricas ──────────────

  const loadData = useCallback(async () => {
    if (!merchantId) { setLoading(false); return; }

    const [statsRes, ordersRes] = await Promise.all([
      supabase.from('merchant_stats').select('*').eq('merchant_id', merchantId).single(),
      supabase
        .from('orders')
        .select('created_at, quantity, total')
        .eq('merchant_id', merchantId)
        .eq('status', 'delivered')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    if (statsRes.data) setStats(statsRes.data as MerchantStats);

    // Agregar ventas por franja horaria (últimos 7 días)
    const FRANJAS: HourBucket[] = [
      { label: 'Mañana\n7-12', count: 0, revenue: 0 },
      { label: 'Mediodía\n12-15', count: 0, revenue: 0 },
      { label: 'Tarde\n15-19', count: 0, revenue: 0 },
      { label: 'Noche\n19-23', count: 0, revenue: 0 },
    ];

    (ordersRes.data ?? []).forEach(o => {
      const h = new Date(o.created_at).getHours();
      const idx = h < 12 ? 0 : h < 15 ? 1 : h < 19 ? 2 : 3;
      FRANJAS[idx]!.count   += o.quantity;
      FRANJAS[idx]!.revenue += o.total;
    });

    setBuckets(FRANJAS);
    setLoading(false);
  }, [merchantId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Supabase Realtime: merchant_stats se actualiza en tiempo real ──

  useEffect(() => {
    if (!merchantId) return;
    channelRef.current?.unsubscribe();

    channelRef.current = supabase
      .channel(`merchant-stats-${merchantId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'merchant_stats', filter: `merchant_id=eq.${merchantId}` },
        payload => setStats(payload.new as MerchantStats),
      )
      .subscribe();

    return () => { channelRef.current?.unsubscribe(); };
  }, [merchantId]);

  // ── Solicitar retiro de fondos ────────────────────────────

  const solicitarRetiro = useCallback(async () => {
    if (!stats || stats.pending_payout <= 0) {
      Alert.alert('Sin saldo', 'No tenés fondos disponibles para retirar.');
      return;
    }

    Alert.alert(
      'Solicitar retiro',
      `Vas a solicitar el retiro de ${fmt(stats.pending_payout)}.\n\nProcesamos los retiros los días hábiles dentro de las 48 hs.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: `Retirar ${fmt(stats.pending_payout)}`,
          onPress: async () => {
            setPayoutLoading(true);
            try {
              const { data: session } = await supabase.auth.getSession();
              const res = await fetch(`${WORKER_URL}/payout-request`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization:  `Bearer ${session.session?.access_token}`,
                },
                body: JSON.stringify({ merchant_id: merchantId, amount: stats.pending_payout }),
              });
              const json = await res.json() as { ok?: boolean; error?: string };
              if (json.ok) {
                Alert.alert('¡Listo!', 'Solicitud recibida. Te transferimos en las próximas 48 hs hábiles.');
                loadData();
              } else {
                Alert.alert('Error', json.error ?? 'No se pudo procesar la solicitud.');
              }
            } catch {
              Alert.alert('Error', 'Sin conexión. Intentá de nuevo.');
            } finally {
              setPayoutLoading(false);
            }
          },
        },
      ],
    );
  }, [stats, merchantId, loadData]);

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9faf9' }}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  const s = stats ?? {
    total_revenue: 0, total_orders: 0, total_packs_saved: 0,
    total_saved_kg: 0, customer_rating: 0, rating_count: 0,
    pending_payout: 0, last_payout_at: null, merchant_id: '',
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9faf9' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#f97316', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 12 }}>
          <Text style={{ color: '#fed7aa', fontSize: 15 }}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={{ color: 'white', fontSize: 22, fontWeight: '900' }}>Mis Estadísticas</Text>
        <Text style={{ color: '#fed7aa', fontSize: 13, marginTop: 3 }}>
          Datos en tiempo real · última actualización ahora
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 10, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Métricas clave ── */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#6b7280', paddingHorizontal: 6, marginBottom: 4, marginTop: 4 }}>
          RESUMEN GENERAL
        </Text>

        <View style={{ flexDirection: 'row' }}>
          <MetricCard
            icon="💰"
            label="Plata Recuperada"
            value={fmtShort(s.total_revenue)}
            sub={`${s.total_orders} órdenes entregadas`}
            accent="#16A34A"
          />
          <MetricCard
            icon="📦"
            label="Packs Salvados"
            value={String(s.total_packs_saved)}
            sub={`${s.total_saved_kg.toFixed(1)} kg de comida`}
            accent="#f97316"
          />
        </View>

        <View style={{ flexDirection: 'row' }}>
          <MetricCard
            icon="⭐"
            label="Rating Promedio"
            value={s.rating_count > 0 ? s.customer_rating.toFixed(1) : '—'}
            sub={s.rating_count > 0 ? `${stars(s.customer_rating)} (${s.rating_count} reseñas)` : 'Sin calificaciones aún'}
            accent="#f59e0b"
          />
          <MetricCard
            icon="🌿"
            label="CO₂ Evitado"
            value={`${(s.total_saved_kg * 2.5).toFixed(1)} kg`}
            sub="Est. carbono no emitido"
            accent="#16A34A"
          />
        </View>

        {/* ── Caja de retiro ── */}
        <View style={{
          backgroundColor: s.pending_payout > 0 ? '#f0fdf4' : '#f9faf9',
          borderWidth: 1.5, borderColor: s.pending_payout > 0 ? '#86efac' : '#e5e7eb',
          borderRadius: 20, padding: 20, margin: 6,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Saldo disponible
              </Text>
              <Text style={{ fontSize: 30, fontWeight: '900', color: '#111827', marginTop: 4 }}>
                {fmt(s.pending_payout)}
              </Text>
              {s.last_payout_at && (
                <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                  Último retiro: {new Date(s.last_payout_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 36 }}>🏦</Text>
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: s.pending_payout > 0 ? '#16A34A' : '#e5e7eb',
              borderRadius: 14, padding: 16, alignItems: 'center',
            }}
            onPress={solicitarRetiro}
            disabled={payoutLoading || s.pending_payout <= 0}
          >
            {payoutLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: s.pending_payout > 0 ? 'white' : '#9ca3af', fontSize: 16, fontWeight: '800' }}>
                  {s.pending_payout > 0 ? `Solicitar retiro de ${fmt(s.pending_payout)}` : 'Sin saldo para retirar'}
                </Text>
            }
          </TouchableOpacity>

          <Text style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8, lineHeight: 16 }}>
            Los retiros se procesan en días hábiles dentro de las 48 hs.{'\n'}
            El 15% de cada venta corresponde a la comisión de la plataforma.
          </Text>
        </View>

        {/* ── Gráfico horario ── */}
        <HourChart buckets={buckets} />

        {/* ── Ledger ── */}
        <LedgerList merchantId={merchantId} />

        {/* ── Impacto ambiental ── */}
        <View style={{ backgroundColor: '#ecfdf5', borderRadius: 20, padding: 20, margin: 6, borderWidth: 1, borderColor: '#bbf7d0' }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: '#166534', marginBottom: 12 }}>
            🌱 Tu Impacto Ambiental
          </Text>
          {[
            { label: 'Kilos de comida salvados',    value: `${s.total_saved_kg.toFixed(1)} kg`, icon: '🥗' },
            { label: 'CO₂ equivalente evitado',    value: `${(s.total_saved_kg * 2.5).toFixed(1)} kg`, icon: '🌍' },
            { label: 'Litros de agua ahorrados',   value: `${Math.round(s.total_saved_kg * 155)} L`, icon: '💧' },
          ].map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#bbf7d0' }}>
              <Text style={{ fontSize: 14, color: '#166534' }}>{item.icon} {item.label}</Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#16A34A' }}>{item.value}</Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}
