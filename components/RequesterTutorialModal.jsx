import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBlueTapTheme } from './BlueTapTheme';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import BlueTapBrandMark from './BlueTapBrandMark';
import BlueTapIcon from './BlueTapIcon';

export const TUTORIAL_SEEN_KEY = 'bluetap:requester:tutorial_seen';

export const getTutorialSeenKey = (userId) => {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return TUTORIAL_SEEN_KEY;
  }
  return `${TUTORIAL_SEEN_KEY}:${userId.trim()}`;
};

export const TUTORIAL_STEPS = [
  {
    step: 1,
    badge: 'Step 1 of 5 · Home',
    title: 'Home & Station Discovery',
    description:
      'Locate verified Toledo City refilling stations, check live station availability, view operational hours, and see your recent order activity at a glance.',
    iconName: 'home',
    highlight: 'Toledo City Stations',
  },
  {
    step: 2,
    badge: 'Step 2 of 5 · Add Request',
    title: 'Add Request & Transparent Pricing',
    description:
      'Select purified or alkaline water containers, customize bottle quantities, set your delivery pin, and review upfront pricing with zero hidden fees.',
    iconName: 'plus-circle',
    highlight: 'Transparent Pricing',
  },
  {
    step: 3,
    badge: 'Step 3 of 5 · Requests',
    title: 'Live Requests & Direct Chat',
    description:
      'Track order status from station queue to your doorstep in real time. Chat directly with your assigned distributor to share directions and coordinate arrival.',
    iconName: 'clipboard',
    highlight: 'Live Tracking & Chat',
  },
  {
    step: 4,
    badge: 'Step 4 of 5 · Schedule',
    title: 'Delivery Schedule & Calendar',
    description:
      'View your scheduled refill days, manage recurring deliveries, and check distributor delivery windows so your household never runs out of water.',
    iconName: 'calendar',
    highlight: 'Scheduled Deliveries',
  },
  {
    step: 5,
    badge: 'Step 5 of 5 · Profile',
    title: 'Profile, Security & Help',
    description:
      'Manage personal details, update your account password, toggle BlueTap Assistant visibility, and reopen this guide anytime under Account Settings.',
    iconName: 'user',
    highlight: 'Account & Support',
  },
];

export default function RequesterTutorialModal({ visible, onClose, onComplete, userId }) {
  const { colors, isDark } = useBlueTapTheme();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = TUTORIAL_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === TUTORIAL_STEPS.length - 1;

  const markTutorialComplete = async () => {
    try {
      const storageKey = getTutorialSeenKey(userId);
      await AsyncStorage.setItem(storageKey, 'true');
    } catch {
      // Non-critical local storage fallback
    }
  };

  const handleSkip = async () => {
    await markTutorialComplete();
    setCurrentStepIndex(0);
    onClose?.();
  };

  const handleNext = async () => {
    if (isLastStep) {
      await markTutorialComplete();
      setCurrentStepIndex(0);
      onComplete?.();
      onClose?.();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const themeColors = colors || BLUETAP_COLORS;
  const styles = getStyles(themeColors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard} accessibilityViewIsModal accessibilityRole="dialog">
          {/* Fixed Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <BlueTapBrandMark color={themeColors.primary || '#0284C7'} size={24} />
              <Text style={styles.headerBrand}>BlueTap Guide</Text>
            </View>
            <TouchableOpacity
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
              style={styles.skipButton}
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable Body */}
          <ScrollView
            style={styles.modalBody}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Step badge */}
            <View style={styles.badgeWrapper}>
              <Text style={styles.badgeText}>{currentStep.badge}</Text>
            </View>

            {/* Step icon illustration card */}
            <View style={styles.stepVisualCard}>
              <View style={styles.stepIconCircle}>
                <BlueTapIcon
                  name={currentStep.iconName}
                  size={32}
                  color={themeColors.onPrimary || '#FFFFFF'}
                />
              </View>
              <View style={styles.highlightPill}>
                <Text style={styles.highlightText}>{currentStep.highlight}</Text>
              </View>
            </View>

            {/* Title & Description */}
            <Text style={styles.stepTitle}>{currentStep.title}</Text>
            <Text style={styles.stepDescription}>{currentStep.description}</Text>

            {/* Dots indicator */}
            <View style={styles.dotsContainer}>
              {TUTORIAL_STEPS.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    index === currentStepIndex && styles.dotActive,
                  ]}
                />
              ))}
            </View>
          </ScrollView>

          {/* Fixed Footer */}
          <View style={styles.modalFooter}>
            {!isFirstStep ? (
              <TouchableOpacity
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel="Previous step"
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <TouchableOpacity
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={isLastStep ? 'Finish tutorial' : 'Next step'}
              style={styles.nextButton}
            >
              <Text style={styles.nextButtonText}>
                {isLastStep ? 'Finish' : 'Next →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay || 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: colors.surface || '#FFFFFF',
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border || '#E2E8F0',
      ...Platform.select({
        web: {
          boxShadow: '0 25px 30px -5px rgba(0, 0, 0, 0.15)',
        },
        default: {
          elevation: 8,
        },
      }),
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border || '#E2E8F0',
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerBrand: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary || '#1E293B',
      letterSpacing: 0.3,
    },
    skipButton: {
      minHeight: 34,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt || '#F1F5F9',
    },
    skipText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary || '#64748B',
    },
    modalBody: {
      maxHeight: 380,
    },
    bodyContent: {
      paddingHorizontal: 24,
      paddingTop: 20,
      paddingBottom: 16,
      alignItems: 'center',
    },
    badgeWrapper: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      backgroundColor: colors.primarySoft || '#E0F2FE',
      marginBottom: 16,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary || '#0284C7',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    stepVisualCard: {
      width: '100%',
      backgroundColor: colors.surfaceAlt || (isDark ? '#1E293B' : '#F8FAFC'),
      borderRadius: 16,
      paddingVertical: 24,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border || '#E2E8F0',
      marginBottom: 20,
    },
    stepIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.primaryAction || colors.primary || '#0284C7',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    highlightPill: {
      backgroundColor: colors.surface || '#FFFFFF',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border || '#E2E8F0',
    },
    highlightText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary || '#1E293B',
    },
    stepTitle: {
      fontSize: 20,
      fontWeight: '900',
      color: colors.textPrimary || '#1E293B',
      textAlign: 'center',
      marginBottom: 10,
    },
    stepDescription: {
      fontSize: 13,
      color: colors.textSecondary || '#64748B',
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 20,
      paddingHorizontal: 8,
    },
    dotsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border || '#CBD5E1',
    },
    dotActive: {
      width: 22,
      borderRadius: 4,
      backgroundColor: colors.primary || '#0284C7',
    },
    modalFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border || '#E2E8F0',
      gap: 12,
    },
    backButton: {
      minHeight: 44,
      paddingHorizontal: 18,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border || '#CBD5E1',
      backgroundColor: colors.surfaceAlt || '#F1F5F9',
    },
    backButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary || '#1E293B',
    },
    nextButton: {
      minHeight: 44,
      paddingHorizontal: 24,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primaryAction || colors.primary || '#0284C7',
    },
    nextButtonText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.onPrimary || '#FFFFFF',
    },
  });
