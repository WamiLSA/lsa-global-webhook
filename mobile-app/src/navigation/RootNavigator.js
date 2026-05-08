import React from 'react';
import { Pressable, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { AppHomeScreen } from '../screens/AppHomeScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { FeatureAreaScreen } from '../screens/FeatureAreaScreen';
import { getAreaByKey } from './mobileAreas';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();

const protectedOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.bg }
};

function MenuButton({ navigation }) {
  return (
    <Pressable onPress={() => navigation.navigate('Home')} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>☰</Text>
    </Pressable>
  );
}

export function RootNavigator() {
  const { token } = useAuth();

  return (
    <Stack.Navigator screenOptions={protectedOptions}>
      {!token ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen
            name="Home"
            component={AppHomeScreen}
            options={({ navigation }) => ({ title: 'LSA Internal OS', headerRight: () => <MenuButton navigation={navigation} /> })}
          />
          <Stack.Screen
            name="Inbox"
            component={InboxScreen}
            options={({ navigation }) => ({ title: 'Inbox / Communications', headerRight: () => <MenuButton navigation={navigation} /> })}
          />
          <Stack.Screen
            name="Conversation"
            component={ConversationScreen}
            options={({ navigation }) => ({ title: 'Thread', headerRight: () => <MenuButton navigation={navigation} /> })}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={({ navigation }) => ({ title: 'Settings & Diagnostics', headerRight: () => <MenuButton navigation={navigation} /> })}
          />
          <Stack.Screen
            name="FeatureArea"
            component={FeatureAreaScreen}
            options={({ route, navigation }) => ({ title: getAreaByKey(route.params?.areaKey)?.shortLabel || 'Internal OS Area', headerRight: () => <MenuButton navigation={navigation} /> })}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
