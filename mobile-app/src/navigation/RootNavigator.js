import React from 'react';
import { Pressable, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MenuScreen } from '../screens/MenuScreen';
import { AreaScreen } from '../screens/AreaScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();

const protectedOptions = ({ navigation }) => ({
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.bg },
  headerLeft: () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open mobile navigation menu"
      onPress={() => navigation.navigate('MobileMenu')}
      style={{ paddingHorizontal: 12, paddingVertical: 6, marginLeft: -8 }}
    >
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>☰</Text>
    </Pressable>
  ),
  headerRight: () => (
    <Pressable onPress={() => navigation.navigate('Home')} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
      <Text style={{ color: '#93c5fd', fontWeight: '800' }}>Home</Text>
    </Pressable>
  )
});

function buildAreaRoute(areaKey) {
  return function AreaRouteScreen(props) {
    return <AreaScreen {...props} route={{ ...props.route, params: { ...(props.route.params || {}), areaKey } }} />;
  };
}

const KnowledgeBaseScreen = buildAreaRoute('kb');
const ProvidersScreen = buildAreaRoute('providers');
const AutomationHubScreen = buildAreaRoute('automation');
const AiToolsScreen = buildAreaRoute('ai-tools');
const ReportsScreen = buildAreaRoute('reports');

export function RootNavigator() {
  const { token } = useAuth();

  return (
    <Stack.Navigator screenOptions={protectedOptions}>
      {!token ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'LSA Internal OS' }} />
          <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: 'Communications Hub' }} />
          <Stack.Screen name="Conversation" component={ConversationScreen} options={{ title: 'Thread' }} />
          <Stack.Screen name="KnowledgeBase" component={KnowledgeBaseScreen} options={{ title: 'Knowledge Base' }} />
          <Stack.Screen name="Providers" component={ProvidersScreen} options={{ title: 'Providers' }} />
          <Stack.Screen name="AutomationHub" component={AutomationHubScreen} options={{ title: 'Automation Hub' }} />
          <Stack.Screen name="AiTools" component={AiToolsScreen} options={{ title: 'AI Tools' }} />
          <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings & Diagnostics' }} />
          <Stack.Screen name="MobileMenu" component={MenuScreen} options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
