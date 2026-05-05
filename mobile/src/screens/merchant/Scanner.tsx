import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, Animated, Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import axios from 'axios';
import { supabase } from '../../services/supabase';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL!;
const QR_PREFIX = 'AS:';

type ScanState = 'idle' | 'scanning' | 'processing' | 'success' | 'error';

interface ScanResult {
  message: string;
  packTitle?: string;
  total?: number;
  netMerchant?: number;
  quantity?: number;
}

function fmtARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

// ─────────────────────────────────────────────────────────────
// Overlay de resultado — éxito o error
// ─────────────────────────────────────────────────────────────

function ResultOverlay({
  state,
  result,
  onReset,
}: {
  state: ScanState;
  result: ScanResult | null;
  onReset: () => void;
}) {
  const scale = useRef(new Animated.Value(0.8)).current;

  React.useEffect(() => {
    if (state === 'success' || state === 'error') {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 6,
      }).start();
    } else {
      scale.setValue(0.8);
    }
  }, [state]);

  if (state !== 'success' && state !== 'error') return null;

  const isOk = state === 'success';

  return (
    <View className="absolute inset-0 bg-black/70 items-center justify-center px-6">
      <Animated.View
        style={{ transform: [{ scale }] }}
        className={`w-full rounded-3xl p-6 ${isOk ? 'bg-green-light border-2 border-green-brand' : 'bg-red-50 border-2 border-red-500'}`}
      >
        <Text className="text-5xl text-center mb-3">{isOk ? '✅' : '❌'}</Text>
        <Text
          className={`text-center text-lg font-black mb-2 ${isOk ? 'text-green-brand' : 'text-red-600'}`}
        >
          {result?.message}
        </Text>

        {isOk && result && (
          <View className="mt-2 gap-1">
            {result.packTitle && (
              <Text className="text-gray-700 text-sm text-center">📦 {result.packTitle}</Text>
            )}
            {result.quantity !== undefined && (
              <Text className="text-gray-700 text-sm text-center">
                Cantidad: {result.quantity} unidad{result.quantity !== 1 ? 'es' : ''}
              </Text>
            )}
            {result.total !== undefined && (
              <Text className="text-gray-700 text-sm text-center">
                Total cobrado: {fmtARS(result.total)}
              </Text>
            )}
            {result.netMerchant !== undefined && (
              <Text className="text-green-brand font-bold text-base text-center mt-1">
                Tu cobro neto: {fmtARS(result.netMerchant)}
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          className={`mt-5 rounded-2xl py-4 ${isOk ? 'bg-green-brand' : 'bg-red-500'}`}
          onPress={onReset}
        >
          <Text className="text-white font-bold text-center text-base">
            {isOk ? 'Escanear otro pack' : 'Reintentar'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Scanner principal
// ─────────────────────────────────────────────────────────────

export function Scanner({ navigation }: { navigation: any }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [result, setResult] = useState<ScanResult | null>(null);

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanState !== 'scanning') return;
      if (!data.startsWith(QR_PREFIX)) return;

      setScanState('processing');
      Vibration.vibrate(80);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const merchantId = sessionData.session?.user?.id;
        if (!merchantId) throw new Error('Sesión expirada');

        const response = await axios.post(
          `${WORKER_URL}/validate-pickup`,
          { qr_token: data, merchant_id: merchantId },
          {
            headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
            timeout: 8_000,
          },
        );

        const order = response.data.order;
        setResult({
          message: response.data.message,
          packTitle: order.pack_title,
          total: order.total,
          netMerchant: order.net_merchant,
          quantity: order.quantity,
        });
        setScanState('success');
        Vibration.vibrate([0, 100, 80, 100]);

      } catch (err: any) {
        const msg =
          err.response?.data?.error ||
          err.message ||
          'Error al validar el QR';
        setResult({ message: msg });
        setScanState('error');
        Vibration.vibrate(400);
      }
    },
    [scanState],
  );

  const reset = useCallback(() => {
    setResult(null);
    setScanState('scanning');
  }, []);

  // Sin permiso de cámara
  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 p-8">
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 p-8">
        <Text className="text-4xl mb-4">📷</Text>
        <Text className="text-gray-800 font-bold text-base text-center mb-2">
          Se necesita acceso a la cámara
        </Text>
        <Text className="text-gray-500 text-sm text-center mb-6">
          Para escanear los códigos QR de tus clientes necesitamos permiso de cámara.
        </Text>
        <TouchableOpacity
          className="bg-green-brand rounded-2xl px-8 py-4"
          onPress={requestPermission}
        >
          <Text className="text-white font-bold text-base">Dar permiso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        onBarcodeScanned={scanState === 'scanning' ? handleBarCodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-14 px-5 pb-4">
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text className="text-white text-base font-semibold">✕ Cerrar</Text>
          </TouchableOpacity>
          <Text className="text-white font-black text-lg">Validar Pick-up</Text>
          <View className="w-16" />
        </View>

        {/* Marco de escaneo */}
        <View className="flex-1 items-center justify-center">
          <View style={{ width: 240, height: 240 }}>
            {/* Esquinas del marco */}
            {[
              { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
              { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
              { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
              { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },
            ].map((style, i) => (
              <View
                key={i}
                style={[
                  {
                    position: 'absolute', width: 28, height: 28,
                    borderColor: '#16A34A', borderWidth: 3,
                    ...style,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Footer */}
        <View className="items-center pb-12 px-6">
          {scanState === 'processing' ? (
            <View className="flex-row items-center gap-3 bg-black/50 rounded-2xl px-5 py-3">
              <ActivityIndicator color="#16A34A" />
              <Text className="text-white font-semibold">Validando código...</Text>
            </View>
          ) : (
            <Text className="text-white text-center text-sm leading-6">
              Apuntá la cámara al código QR del cliente{'\n'}para confirmar la entrega del pack
            </Text>
          )}
        </View>

        {/* Overlay de resultado */}
        <ResultOverlay state={scanState} result={result} onReset={reset} />
      </CameraView>
    </View>
  );
}
