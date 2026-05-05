import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar, useColorScheme, View, ActivityIndicator, Text, Pressable } from 'react-native';
import * as Updates from 'expo-updates';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme';
import { GlobalProgressProvider } from './src/progress/GlobalProgressContext';
import { GlobalProgressOverlay } from './src/progress/GlobalProgressOverlay';

const isExpoUpdatesEnabled = Updates.isEnabled && !__DEV__;

function UpdateBanner() {
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('idle');

  const checkForUpdates = useCallback(async () => {
    if (!isExpoUpdatesEnabled || isChecking || isApplying) {
      return;
    }

    try {
      setIsChecking(true);
      const update = await Updates.checkForUpdateAsync();
      setUpdateStatus(update.isAvailable ? 'available' : 'idle');
    } catch (error) {
      setUpdateStatus('error');
    } finally {
      setIsChecking(false);
    }
  }, [isApplying, isChecking]);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const applyUpdate = useCallback(async () => {
    if (isApplying || updateStatus !== 'available') {
      return;
    }

    try {
      setIsApplying(true);
      await Updates.fetchUpdateAsync();
      setUpdateStatus('ready');
    } catch (error) {
      setUpdateStatus('error');
    } finally {
      setIsApplying(false);
    }
  }, [isApplying, updateStatus]);

  const reloadApp = useCallback(async () => {
    await Updates.reloadAsync();
  }, []);

  const content = useMemo(() => {
    if (isChecking) {
      return {
        message: 'Checking for updates...',
        actionLabel: null,
        action: null
      };
    }

    if (updateStatus === 'available') {
      return {
        message: 'A new update is available.',
        actionLabel: isApplying ? 'Updating...' : 'Tap to update',
        action: applyUpdate
      };
    }

    if (updateStatus === 'ready') {
      return {
        message: 'Update downloaded. Restart app to apply update.',
        actionLabel: 'Restart app',
        action: reloadApp
      };
    }

    if (updateStatus === 'error') {
      return {
        message: 'Unable to check updates right now. Please try again shortly.',
        actionLabel: 'Retry',
        action: checkForUpdates
      };
    }

    return null;
  }, [applyUpdate, checkForUpdates, isApplying, isChecking, reloadApp, updateStatus]);

  if (!content) {
    return null;
  }

  return (
    <View style={{ backgroundColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ color: '#ffffff', fontSize: 13 }}>{content.message}</Text>
      {content.actionLabel ? (
        <Pressable
          onPress={content.action}
          disabled={isApplying}
          style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#ffffff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <Text style={{ color: '#0f172a', fontSize: 12, fontWeight: '600' }}>{content.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AppShell() {
  const scheme = useColorScheme();
  const { initializing } = useAuth();

  if (initializing) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <>
      <UpdateBanner />
      <NavigationContainer theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <RootNavigator />
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <GlobalProgressProvider>
          <AppShell />
          <GlobalProgressOverlay />
        </GlobalProgressProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
