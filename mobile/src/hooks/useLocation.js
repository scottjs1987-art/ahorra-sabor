import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';

export function useLocation() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [loading, setLoading] = useState(true);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Se necesita permiso de ubicación para encontrar comercios cercanos');
      setLoading(false);
      return;
    }

    const coords = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setLocation(coords);
    setLoading(false);
  }, []);

  useEffect(() => { requestLocation(); }, [requestLocation]);

  const calcularDistancia = useCallback((lat2, lon2) => {
    if (!location) return null;
    const { latitude: lat1, longitude: lon1 } = location.coords;
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, [location]);

  return { location, errorMsg, loading, requestLocation, calcularDistancia };
}
