import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { useBlueTapTheme } from './BlueTapTheme';
import BlueTapIcon from './BlueTapIcon';
import { createShadow } from './shadowStyles';

export default function BlueTapEmptyState({
  title = 'No Water Orders Yet',
  description = 'When you have active requests or order history, they will appear here.',
  actionLabel,
  onAction,
  actionStyle,
  actionTextStyle,
  compact = false,
  style,
  themeColors,
  dark,
  variant = 'default',
}) {
  const portalTheme = useBlueTapTheme();
  const colors = themeColors || portalTheme.colors;
  const isDark = typeof dark === 'boolean' ? dark : portalTheme.isDark;
  const styles = createStyles(colors, isDark);

  const flattenedStyle = StyleSheet.flatten(style) || {};
  const isHardcodedWhite = isDark && (flattenedStyle.backgroundColor === '#FFFFFF' || flattenedStyle.backgroundColor === '#fff' || flattenedStyle.backgroundColor === 'white');
  const resolvedStyle = isHardcodedWhite
    ? [
        style,
        {
          backgroundColor: colors.surfaceAlt || 'rgba(30, 41, 59, 0.75)',
          borderColor: colors.border || 'rgba(51, 65, 85, 0.6)',
        },
      ]
    : style;

  return (
    <View style={[styles.container, compact && styles.containerCompact, resolvedStyle]}>
      <View style={[styles.illustrationWrapper, compact && styles.illustrationWrapperCompact]}>
        {variant !== 'default' ? (
          <ContextIllustration variant={variant} styles={styles} colors={colors} compact={compact} />
        ) : <>
        <View style={[styles.dropletGlow, compact && styles.dropletGlowCompact]} />
        <LinearGradient
          colors={isDark ? ['#38BDF8', '#0284C7'] : ['#7DD3FC', '#0284C7']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.droplet, compact && styles.dropletCompact]}
        >
          {/* Highlight shine */}
          <View style={[styles.dropletHighlight, compact && styles.dropletHighlightCompact]} />

          {/* Cute subtle face */}
          <View style={styles.face}>
            <View style={styles.eyesRow}>
              <View style={styles.eye} />
              <View style={styles.eye} />
            </View>
            {/* Friendly smile curve */}
            <View style={styles.mouth} />
          </View>
        </LinearGradient>

        {/* Droplet puddle reflection */}
        <View style={[styles.puddle, compact && styles.puddleCompact]} />
        </>}
      </View>

      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {!!description && <Text style={[styles.description, compact && styles.descriptionCompact]}>{description}</Text>}

      {!!actionLabel && !!onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed, hovered, focused }) => [
            styles.actionButton,
            isDark && styles.actionButtonDark,
            hovered && (isDark ? styles.actionButtonHoveredDark : styles.actionButtonHovered),
            pressed && (isDark ? styles.actionButtonPressedDark : styles.actionButtonPressed),
            focused && (isDark ? styles.actionButtonFocusedDark : styles.actionButtonFocused),
            {
              backgroundColor: isDark
                ? (pressed ? '#0D5FA3' : (hovered ? '#2186D9' : '#1D78C1'))
                : (pressed ? '#0B5FA8' : (hovered ? '#1565C0' : '#187BCD')),
            },
            actionStyle,
          ]}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          dataSet={{ bluetapCta: 'true' }}
        >
          <Text style={[styles.actionButtonText, { color: '#FFFFFF' }, actionTextStyle]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const ASSET_VARIANTS = new Set(['orders', 'requests', 'schedule', 'history', 'notifications', 'products', 'analytics', 'management', 'people', 'applications']);

function ContextIllustration({ variant, styles, colors, compact = false }) {
  if (ASSET_VARIANTS.has(variant) || ['coordination', 'exceptions'].includes(variant)) {
    return (
      <View style={[styles.contextIconSurface, compact && styles.contextIconSurfaceCompact]}>
        <BlueTapIcon name={variant} size={compact ? 24 : 32} color={colors.iconPrimary || colors.primary} />
      </View>
    );
  }
  if (variant === 'dispatch' || variant === 'delivery') {
    return (
      <View style={[styles.contextIconSurface, compact && styles.contextIconSurfaceCompact]}>
        <View style={[styles.truck, compact && { transform: [{ scale: 0.8 }] }]}>
          <View style={styles.truckCargo} />
          <View style={styles.truckCab} />
          <View style={[styles.truckWheel, styles.truckWheelLeft]} />
          <View style={[styles.truckWheel, styles.truckWheelRight]} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.contextIconSurface, compact && styles.contextIconSurfaceCompact]}>
      <Text style={[styles.contextSymbol, compact && { fontSize: 24, lineHeight: 28 }]}>{variant === 'coordination' ? '⇄' : '!'}</Text>
    </View>
  );
}

const createStyles = (colors, isDark) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 28,
      paddingHorizontal: 22,
      borderRadius: 16,
      backgroundColor: isDark ? (colors.surfaceAlt || 'rgba(30, 41, 59, 0.75)') : (colors.surface || '#FFFFFF'),
      borderWidth: 1,
      borderColor: isDark ? (colors.border || 'rgba(51, 65, 85, 0.6)') : (colors.border || '#D7ECFF'),
      marginVertical: 8,
      width: '100%',
      ...createShadow({
        color: '#0D47A1',
        elevation: 4,
        opacity: 0.1,
        radius: 8,
        offset: { width: 0, height: 4 },
      }),
    },
    containerCompact: {
      paddingVertical: 18,
      paddingHorizontal: 18,
      marginVertical: 4,
    },
    illustrationWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      position: 'relative',
    },
    illustrationWrapperCompact: {
      marginBottom: 10,
    },
    contextIconSurface: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? colors.surfaceAlt : colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contextIconSurfaceCompact: {
      width: 50,
      height: 50,
      borderRadius: 25,
    },
    titleCompact: {
      fontSize: 15,
      lineHeight: 20,
    },
    descriptionCompact: {
      fontSize: 12,
      lineHeight: 17,
      marginTop: 3,
    },
    contextSymbol: {
      color: colors.primary,
      fontSize: 34,
      fontWeight: '800',
      lineHeight: 39,
    },
    truck: {
      width: 42,
      height: 28,
      position: 'relative',
    },
    truckCargo: {
      position: 'absolute',
      left: 1,
      top: 4,
      width: 25,
      height: 17,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    truckCab: {
      position: 'absolute',
      right: 1,
      top: 9,
      width: 14,
      height: 12,
      borderTopRightRadius: 5,
      backgroundColor: colors.primary,
    },
    truckWheel: {
      position: 'absolute',
      bottom: 1,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.textPrimary,
    },
    truckWheelLeft: { left: 8 },
    truckWheelRight: { right: 5 },
    dropletGlow: {
      position: 'absolute',
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(186, 230, 253, 0.45)',
    },
    dropletGlowCompact: {
      width: 70,
      height: 70,
      borderRadius: 35,
    },
    droplet: {
      width: 56,
      height: 56,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 28,
      borderBottomLeftRadius: 28,
      borderBottomRightRadius: 28,
      transform: [{ rotate: '-45deg' }],
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#0284C7',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    dropletCompact: {
      width: 48,
      height: 48,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 24,
      borderBottomLeftRadius: 24,
      borderBottomRightRadius: 24,
    },
    dropletHighlight: {
      position: 'absolute',
      top: 8,
      right: 12,
      width: 10,
      height: 6,
      borderRadius: 4,
      backgroundColor: 'rgba(255, 255, 255, 0.55)',
      transform: [{ rotate: '25deg' }],
    },
    dropletHighlightCompact: {
      top: 6,
      right: 10,
      width: 8,
      height: 5,
    },
    face: {
      transform: [{ rotate: '45deg' }],
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    eyesRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 4,
    },
    eye: {
      width: 4,
      height: 5,
      borderRadius: 2,
      backgroundColor: '#0F172A',
    },
    mouth: {
      width: 8,
      height: 4,
      borderBottomWidth: 2,
      borderBottomColor: '#0F172A',
      borderBottomLeftRadius: 4,
      borderBottomRightRadius: 4,
    },
    puddle: {
      width: 42,
      height: 6,
      borderRadius: 3,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.3)' : '#BAE6FD',
      marginTop: 8,
    },
    puddleCompact: {
      width: 36,
      height: 5,
      marginTop: 6,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary || '#12304A',
      textAlign: 'center',
      marginBottom: 6,
    },
    description: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary || '#64748B',
      textAlign: 'center',
      maxWidth: 290,
      marginBottom: 18,
    },
    actionButton: {
      backgroundColor: '#187BCD',
      paddingHorizontal: 24,
      paddingVertical: 12,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: '#1565C0',
      ...createShadow({
        color: '#0B5FA8',
        elevation: 3,
        opacity: 0.18,
        radius: 6,
        offset: { width: 0, height: 3 },
      }),
    },
    actionButtonDark: {
      backgroundColor: '#1D78C1',
      borderColor: '#38BDF8',
      ...createShadow({
        color: '#000000',
        elevation: 4,
        opacity: 0.3,
        radius: 6,
        offset: { width: 0, height: 3 },
      }),
    },
    actionButtonHovered: {
      backgroundColor: '#1565C0',
      borderColor: '#0B5FA8',
      transform: [{ translateY: -1 }],
    },
    actionButtonHoveredDark: {
      backgroundColor: '#2186D9',
      borderColor: '#70BDF2',
      transform: [{ translateY: -1 }],
    },
    actionButtonPressed: {
      backgroundColor: '#0B5FA8',
      transform: [{ translateY: 0 }, { scale: 0.98 }],
      opacity: 0.92,
    },
    actionButtonPressedDark: {
      backgroundColor: '#0D5FA3',
      transform: [{ translateY: 0 }, { scale: 0.98 }],
      opacity: 0.92,
    },
    actionButtonFocused: {
      borderColor: '#42A5F5',
    },
    actionButtonFocusedDark: {
      borderColor: '#70BDF2',
    },
    actionButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  });
