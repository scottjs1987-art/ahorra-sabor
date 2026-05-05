import 'expo-router/entry';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './src/services/firebase';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [isMerchant, setIsMerchant] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        setIsMerchant(userDoc.data()?.isMerchant === true);
      }
      setUser(firebaseUser);
    });
    return unsub;
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return <AppNavigator isMerchant={isMerchant} />;
}
