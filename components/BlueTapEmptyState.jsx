import React from 'react';
import { Image, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { useBlueTapTheme } from './BlueTapTheme';

export default function BlueTapEmptyState({
  title = 'No Water Orders Yet',
  description = 'When you have active requests or order history, they will appear here.',
  actionLabel,
  onAction,
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

  return (
    <View style={[styles.container, compact && styles.containerCompact, style]}>
      <View style={styles.illustrationWrapper}>
        {variant !== 'default' ? (
          <ContextIllustration variant={variant} styles={styles} />
        ) : <>
        <View style={styles.dropletGlow} />
        <LinearGradient
          colors={isDark ? ['#38BDF8', '#0284C7'] : ['#7DD3FC', '#0284C7']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.droplet, compact && styles.dropletCompact]}
        >
          {/* Highlight shine */}
          <View style={styles.dropletHighlight} />

          {/* Cute subtle face */}
          <View style={styles.face}>
            <View style={styles.eyesRow}>
              <View style={styles.eye} />
              <View style={styles.eye} />
            </View>
            {/* Sad / pout mouth curve */}
            <View style={styles.mouth} />
          </View>
        </LinearGradient>

        {/* Droplet puddle reflection */}
        <View style={[styles.puddle, compact && styles.puddleCompact]} />
        </>}
      </View>

      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.description}>{description}</Text>}

      {!!actionLabel && !!onAction && (
        <TouchableOpacity
          onPress={onAction}
          style={styles.actionButton}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const ICON_ASSETS = {
  orders: require('../assets/icons/ballot.png'),
  management: require('../assets/icons/pencil.png'),
  people: require('../assets/icons/user.png'),
  applications: require('../assets/icons/square-plus.png'),
};

function ContextIllustration({ variant, styles }) {
  if (ICON_ASSETS[variant]) {
    return (
      <View style={styles.contextIconSurface}>
        <Image source={ICON_ASSETS[variant]} style={styles.contextAsset} resizeMode="contain" />
      </View>
    );
  }
  if (variant === 'dispatch') {
    return (
      <View style={styles.contextIconSurface}>
        <View style={styles.truck}>
          <View style={styles.truckCargo} />
          <View style={styles.truckCab} />
          <View style={[styles.truckWheel, styles.truckWheelLeft]} />
          <View style={[styles.truckWheel, styles.truckWheelRight]} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.contextIconSurface}>
      <Text style={styles.contextSymbol}>{variant === 'coordination' ? '⇄' : '!'}</Text>
    </View>
  );
}

const createStyles = (colors, isDark) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 36,
      paddingHorizontal: 24,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.45)' : 'rgba(255, 255, 255, 0.85)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(226, 232, 240, 0.8)',
      marginVertical: 12,
    },
    containerCompact: {
      paddingVertical: 22,
      paddingHorizontal: 16,
      marginVertical: 8,
    },
    illustrationWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      position: 'relative',
    },
    contextIconSurface: {
      width: 68,
      height: 68,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? colors.surfaceAlt : colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contextAsset: {
      width: 32,
      height: 32,
      tintColor: colors.primary,
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
      width: 44,
      height: 44,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 22,
      borderBottomLeftRadius: 22,
      borderBottomRightRadius: 22,
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
      borderTopWidth: 2,
      borderTopColor: '#0F172A',
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
    },
    puddle: {
      width: 42,
      height: 6,
      borderRadius: 3,
      backgroundColor: isDark ? 'rgba(56, 189, 248, 0.3)' : '#BAE6FD',
      marginTop: 8,
    },
    puddleCompact: {
      width: 32,
      height: 5,
      marginTop: 6,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary || '#1E293B',
      textAlign: 'center',
      marginBottom: 6,
    },
    description: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary || '#64748B',
      textAlign: 'center',
      maxWidth: 280,
      marginBottom: 16,
    },
    actionButton: {
      backgroundColor: BLUETAP_COLORS.primary,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
  });
