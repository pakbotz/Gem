import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';

type AuthMode = 'welcome' | 'login';

export default function AuthLanding({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');

  function submit() {
    // Demo only: any email/password pair continues; no auth service is connected.
    onSuccess(email.trim() || 'demo@gem.local');
  }

  return <View style={styles.screen}>
    <LinearGradient
      colors={mode === 'welcome'
        ? ['#211D5A', '#8560CA', '#DE9CB6', '#FAC69D']
        : ['#5A528A', '#B4BBE7', '#F4E6CB']}
      locations={mode === 'welcome' ? [0.14, 0.49, 0.70, 0.86] : [0.1875, 0.5625, 0.8125]}
      start={{ x: 0.08, y: 0.08 }}
      end={{ x: 0.9, y: 0.92 }}
      style={StyleSheet.absoluteFill}
    />
    {mode === 'welcome' && <LinearGradient
      pointerEvents="none"
      colors={['rgba(255,178,123,0.9)', 'rgba(244,171,160,0.65)', 'rgba(160,110,166,0.32)', 'transparent']}
      locations={[0, 0.45, 0.725, 1]}
      start={{ x: 0.64, y: 0.88 }}
      end={{ x: 0.45, y: 0.1 }}
      style={StyleSheet.absoluteFill}
    />}

    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {mode === 'welcome'
          ? <WelcomeScreen onGetStarted={() => { setMessage(''); setMode('login'); }} />
          : <LoginScreen
              email={email}
              password={password}
              showPassword={showPassword}
              message={message}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
              onTogglePassword={() => setShowPassword(value => !value)}
              onBack={() => { setMessage(''); setMode('welcome'); }}
              onForgotPassword={() => setMessage('Demo login accepts any password. Password reset is not connected.')}
              onSubmit={submit}
            />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}

function WelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
  const { height } = useWindowDimensions();
  return <View style={styles.welcome}>
    <Text accessibilityRole="header" style={styles.gemTitle}>Gem</Text>
    <View style={styles.welcomeSpacerLarge} />
    <Pressable accessibilityRole="button" onPress={onGetStarted} style={({ pressed }) => [styles.getStarted, pressed && styles.pressed]}>
      <Text style={styles.getStartedText}>Get Started</Text>
    </Pressable>
    <View style={styles.welcomeSpacerSmall} />
    <Text style={[styles.tagline, { transform: [{ translateY: -height / 7 }] }]}>Understand your bill.{ '\n' }Stay in control.</Text>
  </View>;
}

function LoginScreen({ email, password, showPassword, message, onEmailChange, onPasswordChange, onTogglePassword, onBack, onForgotPassword, onSubmit }: {
  email: string;
  password: string;
  showPassword: boolean;
  message: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onBack: () => void;
  onForgotPassword: () => void;
  onSubmit: () => void;
}) {
  return <View style={styles.loginScreen}>
    <View style={styles.loginNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to welcome" onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>
    </View>
    <Text accessibilityRole="header" style={styles.loginTitle}>Login</Text>

    <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <View style={styles.inputBubble}>
          <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
            <Path d="M4.636 5.045H19.363C20.267 5.045 21 5.778 21 6.682V17.318C21 18.222 20.267 18.954 19.364 18.954H4.636C3.733 18.955 3 18.222 3 17.318V6.682C3 5.778 3.733 5.045 4.636 5.045Z" stroke="#1A1A1A" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Path d="M3.119 6.075L10.813 11.578C11.508 12.075 12.442 12.076 13.138 11.58L20.876 6.061" stroke="#1A1A1A" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email address"
            placeholderTextColor="#24232B"
            returnKeyType="next"
            textContentType="emailAddress"
            value={email}
            onChangeText={onEmailChange}
            style={styles.input}
          />
        </View>

        <View style={styles.inputBubble}>
          <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
            <Path d="M8 10V7C8 4.791 9.791 3 12 3C14.209 3 16 4.791 16 7V10M17 21H7C5.895 21 5 20.105 5 19V12C5 10.895 5.895 10 7 10H17C18.105 10 19 10.895 19 12V19C19 20.105 18.105 21 17 21ZM12 14V17" stroke="#1A1A1A" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Password"
            placeholderTextColor="#24232B"
            secureTextEntry={!showPassword}
            textContentType="password"
            value={password}
            onChangeText={onPasswordChange}
            style={styles.input}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={onTogglePassword} hitSlop={8} style={styles.eyeButton}>
            <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
              <Path d="M3.118 12.467C2.961 12.176 2.961 11.823 3.118 11.532C5.01 8.033 8.505 5 12 5C15.495 5 18.99 8.033 20.882 11.533C21.039 11.824 21.039 12.177 20.882 12.468C18.99 15.967 15.495 19 12 19C8.505 19 5.01 15.967 3.118 12.467Z" stroke="#1A1A1A" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <Path d="M14.1213 9.87868C15.2929 11.0503 15.2929 12.9498 14.1213 14.1213C12.9497 15.2929 11.0502 15.2929 9.87866 14.1213C8.70709 12.9497 8.70709 11.0502 9.87866 9.87868C11.0502 8.70711 12.9497 8.70711 14.1213 9.87868Z" stroke="#1A1A1A" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={onForgotPassword} hitSlop={8} style={styles.forgotButton}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={onSubmit} style={({ pressed }) => [styles.loginButton, pressed && styles.pressed]}>
          <Text style={styles.loginButtonText}>Login</Text>
        </Pressable>
        {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
        <Text style={styles.demoNote}>Demo login: any email and password work.</Text>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#5A528A' },
  safeArea: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  welcome: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 34 },
  gemTitle: { marginTop: '15%', fontFamily: 'CanelaThin', fontSize: 75, lineHeight: 88, color: '#FFFFFF', textAlign: 'center' },
  welcomeSpacerLarge: { flex: 2 },
  getStarted: { width: 220, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 30, backgroundColor: 'rgba(102, 72, 145, 0.86)' },
  getStartedText: { fontFamily: 'CanelaThin', fontSize: 20, color: '#FFFFFF' },
  welcomeSpacerSmall: { flex: 1 },
  tagline: { marginBottom: 10, fontSize: 15, lineHeight: 22, fontWeight: '500', color: '#FFFFFF', textAlign: 'center' },
  loginScreen: { flex: 1, paddingHorizontal: 15 },
  loginNav: { minHeight: 42, justifyContent: 'center' },
  backButton: { width: 44, height: 42, justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 38, color: 'rgba(255,255,255,0.9)' },
  loginTitle: { marginTop: 4, fontFamily: 'CanelaThin', fontSize: 56, lineHeight: 68, color: '#FFFFFF', textAlign: 'center' },
  loginScroll: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  form: { gap: 16 },
  inputBubble: { minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#1A1A1A', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  input: { flex: 1, minHeight: 44, paddingVertical: 8, fontSize: 14, color: '#1A1A1A' },
  eyeButton: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  forgotButton: { minHeight: 30, alignSelf: 'flex-end', justifyContent: 'center', marginTop: -5 },
  forgotText: { color: '#6F74DD', fontSize: 14 },
  loginButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 27, backgroundColor: '#6F74DD' },
  loginButtonText: { fontFamily: 'CanelaThin', fontSize: 20, color: '#FFFFFF' },
  demoNote: { textAlign: 'center', fontSize: 12, color: '#34313E' },
  message: { textAlign: 'center', fontSize: 13, lineHeight: 18, color: '#34313E' },
  pressed: { opacity: 0.78 },
});
