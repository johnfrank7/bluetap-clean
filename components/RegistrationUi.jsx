import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BLUETAP_COLORS } from '../constants/bluetapTheme';

export const REGISTRATION_STEPS = ['Account', 'Personal', 'Identity', 'Credentials', 'Verify'];

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

export function RegistrationStepper({ currentStep, completedSteps = [], onStepPress, disabled = false }) {
  return <View style={styles.stepper} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 5, now: currentStep }}>
    {REGISTRATION_STEPS.map((label, index) => {
      const number = index + 1;
      const complete = completedSteps.includes(number);
      const current = number === currentStep;
      const warning = number < currentStep && !complete;
      const clickable = typeof onStepPress === 'function' && !disabled && !current;
      return <View key={label} style={styles.stepItem}>
        {index > 0 && <View style={[styles.connector, completedSteps.includes(number - 1) && styles.connectorComplete]} />}
        <TouchableOpacity
          style={styles.stepButton}
          disabled={!clickable}
          onPress={() => onStepPress?.(number)}
          accessibilityRole="button"
          accessibilityLabel={`Step ${number}: ${label}`}
          accessibilityHint={clickable ? 'Open this registration step' : undefined}
          accessibilityState={{ selected: current, disabled: !clickable }}
        >
          <View style={[
            styles.stepCircle,
            complete && styles.stepCircleComplete,
            current && styles.stepCircleCurrent,
            warning && styles.stepCircleWarning,
          ]}>
            <Text style={[styles.stepNumber, (complete || current) && styles.stepNumberActive, warning && styles.stepNumberWarning]}>
              {current ? number : complete ? '✓' : warning ? '!' : number}
            </Text>
          </View>
          <Text numberOfLines={1} style={[styles.stepLabel, current && styles.stepLabelCurrent, warning && styles.stepLabelWarning]}>{label}</Text>
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
  backDisabled = false,
  primaryDisabled = false,
  loading = false,
}) {
  return <View style={[styles.actions, stacked && styles.actionsStacked]}>
    <TouchableOpacity style={[styles.backButton, stacked && styles.stackedButton]} onPress={onBack} disabled={backDisabled || loading} accessibilityRole="button" accessibilityState={{ disabled: backDisabled || loading }}>
      <Text style={styles.backText}>{backLabel}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={[styles.primaryButton, stacked && styles.stackedButton, primaryDisabled && styles.primaryDisabled]} onPress={onPrimary} disabled={primaryDisabled || loading} accessibilityRole="button" accessibilityState={{ disabled: primaryDisabled || loading, busy: loading }}>
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
  stepper: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative', minWidth: 0 },
  connector: { position: 'absolute', height: 2, width: '100%', backgroundColor: '#D9E7F1', top: 14, left: '-50%', zIndex: 0 },
  connectorComplete: { backgroundColor: '#65AEE7' },
  stepButton: { width: '100%', minHeight: 50, alignItems: 'center', position: 'relative', zIndex: 2 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E8F1F8', borderWidth: 1, borderColor: '#D5E4EF', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 3 },
  stepCircleComplete: { backgroundColor: '#E4F5EC', borderColor: '#87C9A4' },
  stepCircleCurrent: { backgroundColor: BLUETAP_COLORS.primary, borderColor: BLUETAP_COLORS.primary },
  stepCircleWarning: { backgroundColor: '#FFF7E6', borderColor: '#E7B85B' },
  stepNumber: { color: '#68839A', fontSize: 12, fontWeight: '800' },
  stepNumberActive: { color: BLUETAP_COLORS.white },
  stepNumberWarning: { color: '#9A6416' },
  stepLabel: { maxWidth: '100%', paddingHorizontal: 2, color: '#7890A3', fontSize: 10, marginTop: 6, textAlign: 'center' },
  stepLabelCurrent: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  stepLabelWarning: { color: '#9A6416', fontWeight: '700' },
  notice: { width: '100%', borderWidth: 1, borderColor: '#BBD8EE', backgroundColor: '#EFF7FD', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18 },
  noticeWarning: { borderColor: '#E8C77F', backgroundColor: '#FFF8E8' },
  noticeError: { borderColor: '#E7A6A1', backgroundColor: '#FFF1F0' },
  noticeSuccess: { borderColor: '#A8D5BA', backgroundColor: '#F0FAF4' },
  noticeTitle: { color: '#285775', fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  noticeMessage: { color: '#41647C', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 2 },
  warningText: { color: '#865A16' }, errorText: { color: '#A72C25' }, successText: { color: '#26764A' },
  noticeAction: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, marginTop: 5 },
  noticeActionText: { color: BLUETAP_COLORS.primary, fontSize: 13, fontWeight: '800' },
  actions: { width: '100%', flexDirection: 'row', gap: 12, marginTop: 18 },
  actionsStacked: { flexDirection: 'column-reverse', gap: 10 },
  backButton: { minHeight: 50, minWidth: 92, paddingHorizontal: 20, borderWidth: 1, borderColor: BLUETAP_COLORS.primary, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUETAP_COLORS.primarySoft },
  primaryButton: { flex: 1, minHeight: 50, paddingHorizontal: 18, borderRadius: 11, backgroundColor: BLUETAP_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  stackedButton: { width: '100%', flex: 0 },
  primaryDisabled: { backgroundColor: BLUETAP_COLORS.primary, opacity: 0.48 },
  backText: { color: BLUETAP_COLORS.primaryDeep, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  primaryText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  primaryTextDisabled: { color: BLUETAP_COLORS.white },
});
