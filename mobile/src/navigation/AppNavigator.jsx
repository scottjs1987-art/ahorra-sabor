import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import { HomeScreen } from '../screens/user/HomeScreen';
import { PackDetailScreen } from '../screens/user/PackDetailScreen';
import { MyOrdersScreen } from '../screens/user/MyOrdersScreen';
import { DashboardScreen } from '../screens/merchant/DashboardScreen';
import { PublishPackScreen } from '../screens/merchant/PublishPackScreen';
import { ScanQRScreen } from '../screens/merchant/ScanQRScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function UserTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#16A34A',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { borderTopWidth: 0, elevation: 12, shadowOpacity: 0.1 },
      }}
    >
      <Tab.Screen
        name="Inicio"
        component={HomeScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🏠</Text> }}
      />
      <Tab.Screen
        name="MisCompras"
        component={MyOrdersScreen}
        options={{
          title: 'Mis Compras',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🛍</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

function MerchantTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#F97316',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { borderTopWidth: 0, elevation: 12, shadowOpacity: 0.1 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>📊</Text> }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator({ isMerchant = false }) {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isMerchant ? (
          <>
            <Stack.Screen name="MerchantHome" component={MerchantTabs} />
            <Stack.Screen
              name="PublicarPack"
              component={PublishPackScreen}
              options={{ headerShown: true, title: 'Nuevo Pack', headerTintColor: '#F97316' }}
            />
            <Stack.Screen
              name="EscanearQR"
              component={ScanQRScreen}
              options={{ presentation: 'fullScreenModal' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="UserHome" component={UserTabs} />
            <Stack.Screen
              name="PackDetalle"
              component={PackDetailScreen}
              options={{ headerShown: true, title: 'Pack Sorpresa', headerTintColor: '#16A34A' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
