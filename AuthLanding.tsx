import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ui } from './theme';
import Wordmark from './Wordmark';

/** Gradient welcome screen. Get Started enters the app; there is no login. */
export default function AuthLanding({ onGetStarted }: { onGetStarted: () => void }) {
  return <View style={styles.screen}>
    <LinearGradient
      colors={['#211D5A', '#8560CA', '#DE9CB6', '#FAC69D']}
      locations={[0.14, 0.49, 0.70, 0.86]}
      start={{ x: 0.08, y: 0.08 }}
      end={{ x: 0.9, y: 0.92 }}
      style={StyleSheet.absoluteFill}
    />
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(255,178,123,0.9)', 'rgba(244,171,160,0.65)', 'rgba(160,110,166,0.32)', 'transparent']}
      locations={[0, 0.45, 0.725, 1]}
      start={{ x: 0.64, y: 0.88 }}
      end={{ x: 0.45, y: 0.1 }}
      style={StyleSheet.absoluteFill}
    />
    <SafeAreaView style={styles.safeArea}>
      <WelcomeScreen onGetStarted={onGetStarted} />
    </SafeAreaView>
  </View>;
}

function WelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
  return <View style={styles.welcome}>
    <View style={styles.spacerTop} />
    <Wordmark size={104} color="#FFFFFF" />
    <Text style={styles.tagline}>Understand your bill.{'\n'}Stay in control.</Text>
    <View style={styles.spacerBottom} />
    <Pressable accessibilityRole="button" onPress={onGetStarted} style={({ pressed }) => [ui.button, styles.getStarted, pressed && ui.pressed]}>
      <Text style={ui.buttonText}>Get Started</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#5A528A' },
  safeArea: { flex: 1, backgroundColor: 'transparent' },
  welcome: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 48 },
  // Places the wordmark just above the vertical middle of the screen.
  spacerTop: { flex: 5 },
  tagline: { marginTop: 8, fontSize: 17, lineHeight: 25, fontWeight: '500', color: '#FFFFFF', textAlign: 'center' },
  spacerBottom: { flex: 6 },
  getStarted: { alignSelf: 'stretch', backgroundColor: 'rgba(102, 72, 145, 0.86)' },
});
