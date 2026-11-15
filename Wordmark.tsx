/** The "Gem" wordmark in Canela Thin, thickened by layering slightly offset copies. */
import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { colors, fonts } from './theme';

// Canela ships only in Thin. Copies offset in eight directions act like a same-color
// outline, adding weight without changing the letterforms.
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

export default function Wordmark({ size, color = colors.ink, weight = 0.008, style }: {
  size: number;
  color?: string;
  /** Outline thickness as a fraction of the font size. */
  weight?: number;
  style?: TextStyle;
}) {
  const text: TextStyle = { fontFamily: fonts.wordmark, fontSize: size, lineHeight: Math.round(size * 1.16), color, textAlign: 'center' };
  const offset = size * weight;
  return <View accessible accessibilityRole="header" accessibilityLabel="Gem" style={style}>
    <Text style={text}>Gem</Text>
    {DIRECTIONS.map(([x, y], i) =>
      <Text key={i} accessible={false} importantForAccessibility="no-hide-descendants"
        style={[text, StyleSheet.absoluteFill, { transform: [{ translateX: x * offset }, { translateY: y * offset }] }]}>Gem</Text>)}
  </View>;
}
