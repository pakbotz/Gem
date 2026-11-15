/** Shared design tokens so every screen uses the same colors, type and shapes. */
import { StyleSheet } from 'react-native';

export const colors = {
  background: '#F8F6F2',
  card: '#FFFFFF',
  ink: '#24232B',
  body: '#4D4953',
  muted: '#716D79',
  faint: '#A9A4B0',
  line: '#E1DCD5',
  inputLine: '#CFC9C1',
  purple: '#5D3ED3',
  lilac: '#ECEBFA',
  lilacLine: '#C9BEEB',
  blush: '#E9D4D1',
  track: '#ECE8F3',
  red: '#B85B63',
  amber: '#C9A227',
  green: '#2F8A57',
  error: '#A01818',
} as const;

export const fonts = {
  /** Canela ships only in Thin; used for display headings. */
  display: 'CanelaThin',
  /** The "Gem" wordmark: Canela Thin, the same on every screen. */
  wordmark: 'CanelaThin',
};

export const radius = { card: 18, row: 14, button: 28, input: 10 } as const;

export const type = StyleSheet.create({
  /** Screen titles. */
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.ink },
  /** Section and card headings. */
  heading: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, color: colors.purple },
  body: { fontSize: 15, lineHeight: 22, color: colors.body },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.ink },
  small: { fontSize: 13, lineHeight: 19, color: colors.body },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.muted },
  caption: { fontSize: 11, lineHeight: 16, color: colors.muted },
  link: { fontSize: 14, fontWeight: '600', color: colors.purple },
  error: { fontSize: 14, lineHeight: 20, color: colors.error },
});

export const ui = StyleSheet.create({
  button: { minHeight: 56, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, backgroundColor: colors.purple },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.purple },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  buttonTextSecondary: { color: colors.purple },
  card: { padding: 18, gap: 10, borderRadius: radius.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.inputLine, borderRadius: radius.input, backgroundColor: colors.card, color: colors.ink, fontSize: 15 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
