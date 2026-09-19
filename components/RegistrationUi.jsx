import React from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BLUETAP_COLORS } from '../constants/bluetapTheme';

const {
  REGISTRATION_STEP_NUMBERS,
  getRegistrationConnectorStates,
  getRegistrationStepStates,
} = require('../services/registrationStepStatus');

export const REGISTRATION_STEPS = ['Account', 'Personal', 'Identity', 'Credentials', 'Verify'];

function AnimatedConnector({ state }) {
  const target = state === 'future' ? 0 : 1;
  const progress = React.useRef(new Animated.Value(target)).current;
  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: target,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, target]);
  return <View style={styles.connectorSegment}>
    <Animated.View style={[
      styles.connectorFill,
      state === 'completed' ? styles.connectorComplete : styles.connectorIncomplete,
      { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
    ]} />
  </View>;
}

function AnimatedStepCircle({ state, children }) {
  const entrance = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    entrance.stopAnimation();
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      speed: 18,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [entrance, state]);
  return <Animated.View style={[
    styles.stepCircle,
    state === 'completed' && styles.stepCircleComplete,
    state === 'incomplete' && styles.stepCircleIncomplete,
    state === 'current' && styles.stepCircleCurrent,
    {
      opacity: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
      transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
    },
  ]}>{children}</Animated.View>;
}

export function RegistrationBrand() {
  return <View style={styles.brand}>
    <Image source={require('../assets/icons/bluetapwhitelogo.png')} style={styles.logo} resizeMode="contain" />
    <View><Text style={styles.brandName}>BlueTap</Text><Text style={styles.tagline}>Water Within Reach</Text></View>
  </View>;
}

export function RegistrationHeading({ title, subtitle }) {
  return <View style={styles.heading}>
    <Text style={styles.headingTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.headingSubtitle}>{subtitle}</Text>}
  </View>;
}

export function RegistrationStepper({
  currentStep,
  completedSteps = [],
  requiredSteps = REGISTRATION_STEP_NUMBERS,
  incompleteSteps = [],
  visibleSteps = REGISTRATION_STEP_NUMBERS,
  onStepPress,
  disabled = false,
}) {
  const stepStates = getRegistrationStepStates({ currentStep, completedSteps, requiredSteps, incompleteSteps });
  const visibleNumbers = Array.isArray(visibleSteps) && visibleSteps.length
    ? visibleSteps.filter((number) => REGISTRATION_STEP_NUMBERS.includes(number))
    : REGISTRATION_STEP_NUMBERS;
  const visibleStates = visibleNumbers.map((number) => stepStates[number - 1]);
  const connectorStates = getRegistrationConnectorStates(visibleStates);
  const currentVisibleIndex = Math.max(0, visibleNumbers.indexOf(currentStep));

  return <View style={styles.stepper} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: visibleNumbers.length, now: currentVisibleIndex + 1 }}>
    <View pointerEvents="none" style={styles.connectorTrack}>
      {connectorStates.map((state, index) => <AnimatedConnector key={index} state={state} />)}
    </View>
    {visibleNumbers.map((number, visibleIndex) => {
      const label = REGISTRATION_STEPS[number - 1];
      const state = stepStates[number - 1];
      const complete = state === 'completed';
      const current = state === 'current';
      const incomplete = state === 'incomplete';
      const clickable = typeof onStepPress === 'function' && !disabled && !current;
      return <View key={label} style={styles.stepItem}>
        <TouchableOpacity
          style={styles.stepButton}
          disabled={!clickable}
          onPress={() => onStepPress?.(number)}
          accessibilityRole="button"
          accessibilityLabel={`Step ${visibleIndex + 1}: ${label}, ${state}`}
          accessibilityHint={clickable ? 'Open this registration step' : undefined}
          accessibilityState={{ selected: current, disabled: !clickable }}
        >
          <AnimatedStepCircle state={state}>
            <Text style={[styles.stepNumber, (complete || current || incomplete) && styles.stepNumberActive]}>
              {complete ? '\u2713' : incomplete ? '\u2715' : visibleIndex + 1}
            </Text>
          </AnimatedStepCircle>
          <Text numberOfLines={1} style={[
            styles.stepLabel,
            complete && styles.stepLabelComplete,
            incomplete && styles.stepLabelIncomplete,
            current && styles.stepLabelCurrent,
          ]}>{label}</Text>
        </TouchableOpacity>
      </View>;
    })}
  </View>;
}

export function RegistrationNotice({ tone = 'info', title, message, actionLabel, onAction }) {
  if (!title && !message) return null;
  return <View
    accessibilityRole={tone === 'error' ? 'alert' : undefined}
    accessibilityLiveRegion="polite"
    style={[styles.notice, tone === 'warning' && styles.noticeWarning, tone === 'error' && styles.noticeError, tone === 'success' && styles.noticeSuccess]}
  >
    {!!title && <Text style={[styles.noticeTitle, tone === 'warning' && styles.warningText, tone === 'error' && styles.errorText, tone === 'success' && styles.successText]}>{title}</Text>}
    {!!message && <Text style={[styles.noticeMessage, tone === 'warning' && styles.warningText, tone === 'error' && styles.errorText, tone === 'success' && styles.successText]}>{message}</Text>}
    {!!actionLabel && typeof onAction === 'function' && <TouchableOpacity onPress={onAction} accessibilityRole="button" style={styles.noticeAction}><Text style={styles.noticeActionText}>{actionLabel}</Text></TouchableOpacity>}
  </View>;
}

export function RegistrationActions({
  stacked = false,
  backLabel = 'Back',
  primaryLabel,
  onBack,
  onPrimary,
  showBack = true,
  backDisabled = false,
  primaryDisabled = false,
  loading = false,
}) {
  return <View style={[styles.actions, stacked && styles.actionsStacked]}>
    {showBack
      ? <TouchableOpacity style={[styles.backButton, stacked && styles.stackedButton]} onPress={onBack} disabled={backDisabled || loading} accessibilityRole="button" accessibilityState={{ disabled: backDisabled || loading }}><Text style={styles.backText}>{backLabel}</Text></TouchableOpacity>
      : !stacked && <View style={styles.backPlaceholder} />}
    <TouchableOpacity
      nativeID="registration-primary-action"
      style={[styles.primaryButton, stacked && styles.stackedButton, (primaryDisabled || loading) && styles.primaryDisabled]}
      onPress={onPrimary}
      disabled={primaryDisabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: primaryDisabled || loading, busy: loading }}
    >
      {loading ? <ActivityIndicator color="#FFF" /> : <Text style={[styles.primaryText, primaryDisabled && styles.primaryTextDisabled]}>{primaryLabel}</Text>}
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logo: { width: 52, height: 52, marginRight: 10 },
  brandName: { color: '#FFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  tagline: { color: 'rgba(255,255,255,.88)', fontSize: 13 },
  heading: { alignItems: 'center', marginBottom: 24 },
  headingTitle: { color: '#17324D', fontSize: 26, lineHeight: 33, fontWeight: '800', textAlign: 'center' },
  headingSubtitle: { color: '#607A90', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 7 },
  stepper: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', position: 'relative', marginBottom: 24 },
  stepItem: { flex: 1, alignItems: 'center', minWidth: 0, zIndex: 2 },
  connectorTrack: { position: 'absolute', height: 4, flexDirection: 'row', top: 13, left: '10%', right: '10%', zIndex: 0 },
  connectorSegment: { flex: 1, height: 4, backgroundColor: '#D9E2E9', overflow: 'hidden' },
  connectorFill: { height: 4 },
  connectorComplete: { backgroundColor: '#1F9D61' },
  connectorIncomplete: { backgroundColor: '#E7A6A1' },
  stepButton: { width: '100%', minHeight: 50, alignItems: 'center', position: 'relative', zIndex: 2 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E8F1F8', borderWidth: 1, borderColor: '#D5E4EF', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 3 },
  stepCircleComplete: { backgroundColor: '#1F9D61', borderColor: '#16824E' },
  stepCircleIncomplete: { backgroundColor: '#C93C37', borderColor: '#A92F2B' },
  stepCircleCurrent: { backgroundColor: BLUETAP_COLORS.primary, borderColor: BLUETAP_COLORS.primary },
  stepNumber: { color: '#68839A', fontSize: 12, fontWeight: '800' },
  stepNumberActive: { color: BLUETAP_COLORS.white },
  stepLabel: { maxWidth: '100%', paddingHorizontal: 2, color: '#7890A3', fontSize: 10, marginTop: 6, textAlign: 'center' },
  stepLabelCurrent: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  stepLabelComplete: { color: '#16824E', fontWeight: '800' },
  stepLabelIncomplete: { color: '#B52F2B', fontWeight: '800' },
  notice: { width: '100%', borderWidth: 1, borderColor: '#BBD8EE', backgroundColor: '#EFF7FD', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18 },
  noticeWarning: { borderColor: '#E8C77F', backgroundColor: '#FFF8E8' },
  noticeError: { borderColor: '#E7A6A1', backgroundColor: '#FFF1F0' },
  noticeSuccess: { borderColor: '#A8D5BA', backgroundColor: '#F0FAF4' },
  noticeTitle: { color: '#285775', fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  noticeMessage: { color: '#41647C', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 2 },
  warningText: { color: '#865A16' }, errorText: { color: '#A72C25' }, successText: { color: '#26764A' },
  noticeAction: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, marginTop: 5 },
  noticeActionText: { color: BLUETAP_COLORS.primary, fontSize: 13, fontWeight: '800' },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 18 },
  actionsStacked: { flexDirection: 'column-reverse', gap: 10 },
  backButton: { width: 150, minHeight: 50, paddingHorizontal: 20, borderWidth: 1, borderColor: BLUETAP_COLORS.primary, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUETAP_COLORS.primarySoft },
  backPlaceholder: { width: 150 },
  primaryButton: { width: 150, minHeight: 50, paddingHorizontal: 18, borderWidth: 1, borderColor: BLUETAP_COLORS.primary, borderRadius: 11, backgroundColor: BLUETAP_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  stackedButton: { width: '100%', flex: 0 },
  primaryDisabled: { backgroundColor: '#78B4E3', borderColor: '#78B4E3', opacity: 1 },
  backText: { color: BLUETAP_COLORS.primaryDeep, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  primaryText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  primaryTextDisabled: { color: BLUETAP_COLORS.white },
});
