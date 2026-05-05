import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useLocation } from './useLocation';

const CATEGORIAS = ['Panadería', 'Rotisería', 'Café', 'Restaurante', 'Verdulería'];

export function usePacks(categoriaFiltro = null) {
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const { calcularDistancia } = useLocation();

  useEffect(() => {
    const ahora = new Date().toISOString();
    const constraints = [
      where('activo', '==', true),
      where('stockDisponible', '>', 0),
      where('ventanaRetiroHasta', '>', ahora),
      orderBy('ventanaRetiroHasta', 'asc'),
    ];

    if (categoriaFiltro) {
      constraints.unshift(where('categoria', '==', categoriaFiltro));
    }

    const q = query(collection(db, 'packs'), ...constraints);

    const unsub = onSnapshot(q, (snap) => {
      const lista = snap.docs.map((doc) => {
        const data = { id: doc.id, ...doc.data() };
        if (data.merchantLat && data.merchantLon) {
          data.distanciaMetros = calcularDistancia(data.merchantLat, data.merchantLon);
        }
        return data;
      });

      lista.sort((a, b) => (a.distanciaMetros ?? Infinity) - (b.distanciaMetros ?? Infinity));
      setPacks(lista);
      setLoading(false);
    });

    return unsub;
  }, [categoriaFiltro, calcularDistancia]);

  return { packs, loading, categorias: CATEGORIAS };
}

export function useMerchantPacks(merchantId) {
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!merchantId) return;
    const q = query(
      collection(db, 'packs'),
      where('merchantId', '==', merchantId),
      orderBy('creadoEn', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPacks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [merchantId]);

  return { packs, loading };
}
