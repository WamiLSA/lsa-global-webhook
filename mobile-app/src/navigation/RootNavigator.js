import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();

const protectedOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.bg }
};

export function RootNavigator() {
  const { token } = useAuth();

  return (
    <Stack.Navigator screenOptions={protectedOptions}>
      {!token ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: 'LSA Internal Inbox' }} />
          <Stack.Screen name="Conversation" component={ConversationScreen} options={{ title: 'Thread' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings & Diagnostics' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
