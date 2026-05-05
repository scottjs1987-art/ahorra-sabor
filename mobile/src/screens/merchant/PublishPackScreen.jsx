import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Switch,
} from 'react-native';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';

const CATEGORIAS = ['Panadería', 'Rotisería', 'Café', 'Restaurante', 'Verdulería'];

const HOY = new Date();
const HORAS_DEFAULT_DESDE = new Date(HOY.setHours(18, 0, 0, 0)).toISOString();
const HORAS_DEFAULT_HASTA = new Date(HOY.setHours(21, 0, 0, 0)).toISOString();

export function PublishPackScreen({ navigation }) {
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    precioOriginal: '',
    precioDescuento: '',
    stockDisponible: '',
    categoria: 'Panadería',
    ventanaRetiroDesde: HORAS_DEFAULT_DESDE,
    ventanaRetiroHasta: HORAS_DEFAULT_HASTA,
    expiraAutomatico: true,
  });
  const [guardando, setGuardando] = useState(false);

  const set = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const precioOriginal = parseFloat(form.precioOriginal) || 0;
  const precioDescuento = parseFloat(form.precioDescuento) || 0;
  const descuentoPorcentaje = precioOriginal > 0
    ? Math.round((1 - precioDescuento / precioOriginal) * 100)
    : 0;

  const validar = () => {
    if (!form.nombre.trim()) return 'El nombre del pack es requerido';
    if (precioOriginal <= 0) return 'El precio original debe ser mayor a $0';
    if (precioDescuento <= 0) return 'El precio con descuento debe ser mayor a $0';
    if (precioDescuento >= precioOriginal) return 'El precio descuento debe ser menor al original';
    if (descuentoPorcentaje < 30) return 'El descuento mínimo es del 30%';
    if (parseInt(form.stockDisponible) <= 0) return 'La cantidad disponible debe ser al menos 1';
    return null;
  };

  const handleGuardar = async () => {
    const error = validar();
    if (error) {
      Alert.alert('Datos incompletos', error);
      return;
    }

    setGuardando(true);
    try {
      const merchantId = auth.currentUser?.uid;
      await addDoc(collection(db, 'packs'), {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim(),
        precioOriginal,
        precioDescuento,
        stockDisponible: parseInt(form.stockDisponible),
        stockReservado: 0,
        categoria: form.categoria,
        merchantId,
        ventanaRetiroDesde: form.ventanaRetiroDesde,
        ventanaRetiroHasta: form.ventanaRetiroHasta,
        expiraAutomatico: form.expiraAutomatico,
        activo: true,
        donado: false,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      });
      Alert.alert('¡Pack publicado!', 'Tu pack ya está visible para los compradores.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'No se pudo publicar el pack. Intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.titulo}>Publicar Pack Sorpresa</Text>

      <View style={styles.seccion}>
        <Text style={styles.label}>Nombre del pack *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Pack del día - Medialunas y facturas"
          value={form.nombre}
          onChangeText={(v) => set('nombre', v)}
          maxLength={80}
        />

        <Text style={styles.label}>Descripción (opcional)</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Contale al comprador qué puede incluir el pack..."
          value={form.descripcion}
          onChangeText={(v) => set('descripcion', v)}
          multiline
          numberOfLines={3}
          maxLength={200}
        />
      </View>

      <View style={styles.seccion}>
        <Text style={styles.label}>Categoría</Text>
        <View style={styles.categoriasRow}>
          {CATEGORIAS.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.catChip, form.categoria === cat && styles.catChipActivo]}
              onPress={() => set('categoria', cat)}
            >
              <Text style={[styles.catChipText, form.categoria === cat && styles.catChipTextActivo]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.seccion}>
        <Text style={styles.label}>Precio original (ARS) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: 2500"
          value={form.precioOriginal}
          onChangeText={(v) => set('precioOriginal', v)}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Precio con descuento (ARS) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: 900"
          value={form.precioDescuento}
          onChangeText={(v) => set('precioDescuento', v)}
          keyboardType="decimal-pad"
        />

        {descuentoPorcentaje > 0 && (
          <View style={[
            styles.descuentoInfo,
            descuentoPorcentaje < 30 ? styles.descuentoInsuficiente : styles.descuentoOk,
          ]}>
            <Text style={{ fontWeight: '700', color: descuentoPorcentaje < 30 ? '#DC2626' : '#16A34A' }}>
              {descuentoPorcentaje}% de descuento
              {descuentoPorcentaje < 30 ? ' — mínimo requerido: 30%' : ' ✓'}
            </Text>
          </View>
        )}

        <Text style={styles.label}>Cantidad disponible *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: 5"
          value={form.stockDisponible}
          onChangeText={(v) => set('stockDisponible', v)}
          keyboardType="number-pad"
        />
      </View>

      <View style={styles.seccion}>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.label}>Expiración automática</Text>
            <Text style={styles.switchSubtexto}>El pack se desactiva al cierre del local</Text>
          </View>
          <Switch
            value={form.expiraAutomatico}
            onValueChange={(v) => set('expiraAutomatico', v)}
            trackColor={{ false: '#D1D5DB', true: '#86EFAC' }}
            thumbColor={form.expiraAutomatico ? '#16A34A' : '#9CA3AF'}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.btnPublicar, guardando && styles.btnDisabled]}
        onPress={handleGuardar}
        disabled={guardando}
      >
        <Text style={styles.btnPublicarText}>
          {guardando ? 'Publicando...' : 'Publicar Pack'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAF9' },
  content: { padding: 20, paddingBottom: 40 },
  titulo: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 20 },
  seccion: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#FAFAFA',
  },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  categoriasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  catChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F3F4F6' },
  catChipActivo: { backgroundColor: '#F97316' },
  catChipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  catChipTextActivo: { color: '#FFF' },
  descuentoInfo: { borderRadius: 10, padding: 10, marginTop: 8 },
  descuentoOk: { backgroundColor: '#ECFDF5' },
  descuentoInsuficiente: { backgroundColor: '#FEE2E2' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchSubtexto: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  btnPublicar: {
    backgroundColor: '#F97316', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnPublicarText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});
