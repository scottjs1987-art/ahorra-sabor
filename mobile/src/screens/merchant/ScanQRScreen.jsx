import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { validatePickupQR } from '../../services/api';
import { auth } from '../../services/firebase';
import { formatARS } from '../../utils/formatters';

export function ScanQRScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [escaneando, setEscaneando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [ultimoEscan, setUltimoEscan] = useState(null);

  const handleBarCodeScanned = async ({ data }) => {
    if (!escaneando || procesando) return;
    if (!data.startsWith('AS-')) return;

    setEscaneando(false);
    setProcesando(true);
    setUltimoEscan(data);

    try {
      const merchantId = auth.currentUser?.uid;
      const { data: response } = await validatePickupQR(data, merchantId);

      Alert.alert(
        '✅ Pack entregado',
        [
          `Cliente: ${response.orden.userId}`,
          `Pack: ${response.orden.packId}`,
          `Total abonado: ${formatARS(response.orden.totalAbonado)}`,
          `Código: ${data}`,
        ].join('\n'),
        [{ text: 'Escanear otro', onPress: () => { setEscaneando(true); setUltimoEscan(null); } }],
      );
    } catch (err) {
      const mensaje = err.response?.data?.error || 'QR inválido o ya utilizado';
      Alert.alert('❌ Error de validación', mensaje, [
        { text: 'Reintentar', onPress: () => { setEscaneando(true); setUltimoEscan(null); } },
        { text: 'Volver', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setProcesando(false);
    }
  };

  if (!permission) return <View style={styles.centered}><ActivityIndicator color="#16A34A" /></View>;

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permisoTexto}>Se necesita acceso a la cámara para escanear QR.</Text>
        <TouchableOpacity style={styles.btnPermiso} onPress={requestPermission}>
          <Text style={styles.btnPermisoText}>Dar permiso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        onBarcodeScanned={escaneando ? handleBarCodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      >
        <View style={styles.overlay}>
          <View style={styles.headerOverlay}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.btnVolver}>✕ Cerrar</Text>
            </TouchableOpacity>
            <Text style={styles.tituloOverlay}>Validar Pick-up</Text>
          </View>

          <View style={styles.marcoContainer}>
            <View style={styles.marco}>
              <View style={[styles.esquina, styles.esquinaTL]} />
              <View style={[styles.esquina, styles.esquinaTR]} />
              <View style={[styles.esquina, styles.esquinaBL]} />
              <View style={[styles.esquina, styles.esquinaBR]} />
            </View>
          </View>

          <View style={styles.footer}>
            {procesando ? (
              <View style={styles.procesandoBox}>
                <ActivityIndicator color="#FFF" />
                <Text style={styles.procesandoText}>Validando código...</Text>
              </View>
            ) : (
              <Text style={styles.instruccion}>
                {escaneando ? 'Apuntá la cámara al código QR del cliente' : `Procesado: ${ultimoEscan}`}
              </Text>
            )}
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const ESQUINA_SIZE = 24;
const ESQUINA_BORDER = 3;

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  headerOverlay: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 20,
  },
  btnVolver: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  tituloOverlay: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  marcoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  marco: {
    width: 240, height: 240,
    backgroundColor: 'transparent',
  },
  esquina: {
    position: 'absolute', width: ESQUINA_SIZE, height: ESQUINA_SIZE,
    borderColor: '#16A34A', borderWidth: ESQUINA_BORDER,
  },
  esquinaTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  esquinaTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  esquinaBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  esquinaBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  footer: {
    padding: 32, alignItems: 'center',
  },
  instruccion: { color: '#FFF', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  procesandoBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  procesandoText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  permisoTexto: { fontSize: 16, color: '#374151', textAlign: 'center', marginBottom: 20 },
  btnPermiso: { backgroundColor: '#16A34A', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  btnPermisoText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
});
