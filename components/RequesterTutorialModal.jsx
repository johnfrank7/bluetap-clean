import React from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';
import { doc, getDocFromServer, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useRequesterData } from './RoleDataProviders';
import { useModerationNotices } from './ModerationNotices';
import TopToastFeedback from './TopToastFeedback';
import { useBlueTapTheme } from './BlueTapTheme';
import BlueTapIcon from './BlueTapIcon';
import useSingleFlightNavigation from './useSingleFlightNavigation';
const { TUTORIAL_STEPS, ORDER_WALKTHROUGH, TOUR_STOPS, savedTourStop, canNavigateFromTour, tourPlacement, clipTourSection, spotlightHole, spotlightPath, spotlightShadeRegions } = require('../services/requesterTour');

export const TUTORIAL_SEEN_KEY = 'bluetap:requester:tutorial_seen';
export const getTutorialSeenKey = (userId) => {
  if (!userId || typeof userId !== 'string' || !userId.trim()) return TUTORIAL_SEEN_KEY;
  return `${TUTORIAL_SEEN_KEY}:${userId.trim()}`;
};

const activeKey = (uid) => `bluetap:requester:tutorial_active:${uid}`;
const completionKey = (uid) => `bluetap:requester:tutorial_completion_pending:${uid}`;
const TourContext = React.createContext({ active: false, ready: false, startTour: () => {}, registerTarget: () => {}, registerLeaveGuard: () => {}, setOrderBlocked: () => {}, notifyTourScroll: () => {} });
export const useRequesterTour = () => React.useContext(TourContext);
export function useRequesterTourTarget(name) {
  const { registerTarget } = useRequesterTour();
  return React.useCallback((node) => registerTarget(name, node), [name, registerTarget]);
}

export function RequesterTourProvider({ children }) {
  const { uid, readiness } = useRequesterData();
  const { loading: noticesLoading, modalOpen: noticeOpen } = useModerationNotices();
  const { colors } = useBlueTapTheme();
  const pathname = usePathname();
  const router = useRouter();
  const { replaceOnce } = useSingleFlightNavigation();
  const [stepIndex, setStepIndex] = React.useState(null);
  const [pendingRoute, setPendingRoute] = React.useState('');
  const [targetVersion, setTargetVersion] = React.useState(0);
  const [orderBlocked, setOrderBlocked] = React.useState(false);
  const [resolvedUid, setResolvedUid] = React.useState('');
  const [completionPending, setCompletionPending] = React.useState(false);
  const [finishError, setFinishError] = React.useState('');
  const [finishing, setFinishing] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [retryLoad, setRetryLoad] = React.useState(0);
  const [reduceMotion, setReduceMotion] = React.useState(() => Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const targets = React.useRef(new Map());
  const leaveGuard = React.useRef(null);
  const measureTarget = React.useRef(null);
  const checkedUid = React.useRef('');
  const startFocus = React.useRef(null);
  const writes = React.useRef(Promise.resolve());
  const finishInFlight = React.useRef(false);
  const active = stepIndex !== null;
  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);
  const registerTarget = React.useCallback((name, node) => {
    if (targets.current.get(name) === node || (!node && !targets.current.has(name))) return;
    if (node) targets.current.set(name, node); else targets.current.delete(name);
    setTargetVersion((value) => value + 1);
  }, []);
  const registerLeaveGuard = React.useCallback((guard) => { leaveGuard.current = guard; }, []);
  const notifyTourScroll = React.useCallback(() => { measureTarget.current?.(); }, []);
  const moveTo = React.useCallback((index) => {
    const destination = TOUR_STOPS[index]?.route;
    if (!destination) return;
    const proceed = () => {
    setStepIndex(index);
    if (uid) writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(activeKey(uid), `v3:${index}`));
    if (pathname !== destination && (canNavigateFromTour(pathname) || pathname === '/requester/requestform')) { setPendingRoute(destination); replaceOnce(destination); }
    else setPendingRoute('');
    };
    if (pathname === '/requester/requestform' && destination !== pathname) {
      // The form owns the draft and its existing unsaved-changes confirmation.
      if (leaveGuard.current) leaveGuard.current(proceed);
      return;
    }
    proceed();
  }, [pathname, replaceOnce, uid]);
  React.useEffect(() => {
    if (!pendingRoute) return undefined;
    if (pathname === pendingRoute) { setPendingRoute(''); return undefined; }
    const timer = setTimeout(() => setPendingRoute(''), 4000);
    return () => clearTimeout(timer);
  }, [pathname, pendingRoute]);
  const startTour = React.useCallback(() => {
    if (!uid) return;
    if (Platform.OS === 'web' && typeof document !== 'undefined') startFocus.current = document.activeElement;
    checkedUid.current = uid;
    moveTo(0);
  }, [moveTo, uid]);
  React.useEffect(() => {
    if (readiness !== 'READY' || noticesLoading || noticeOpen || !uid || checkedUid.current === uid || active) return undefined;
    let mounted = true;
    Promise.all([getDocFromServer(doc(db, 'users', uid)), AsyncStorage.getItem(getTutorialSeenKey(uid)), AsyncStorage.getItem(activeKey(uid)), AsyncStorage.getItem(completionKey(uid))]).then(async ([profile, seen, saved, pendingCompletion]) => {
      if (!mounted) return;
      if (!profile.exists() || auth.currentUser?.uid !== uid) throw new Error('Guide profile unavailable');
      let completed = profile.data().requesterGuideCompleted === true;
      if (!completed && seen === 'true') { await updateDoc(doc(db, 'users', uid), { requesterGuideCompleted: true }); completed = true; }
      if (!mounted || auth.currentUser?.uid !== uid) return;
      const index = savedTourStop(saved);
      if (completed) { checkedUid.current = uid; if (pendingCompletion === 'true') setCompletionPending(true); AsyncStorage.removeItem(activeKey(uid)).catch(() => {}); }
      else if (index >= 0) { checkedUid.current = uid; moveTo(index); }
      else if (pathname === '/requester/r_dashboard') { checkedUid.current = uid; if (seen !== 'true') moveTo(0); }
      if (checkedUid.current === uid) setResolvedUid(uid);
      setLoadError(false);
    }).catch(() => { if (mounted) setLoadError(true); });
    return () => { mounted = false; };
  }, [uid, readiness, noticesLoading, noticeOpen, pathname, active, moveTo, retryLoad]);
  React.useEffect(() => {
    // A user may open the highlighted entry themselves instead of pressing Next.
    if (active && pathname === '/requester/requestform' && TOUR_STOPS[stepIndex]?.target === 'add') moveTo(stepIndex + 1);
  }, [active, pathname, stepIndex, moveTo]);
  React.useEffect(() => { if (checkedUid.current && checkedUid.current !== uid) { checkedUid.current = ''; setStepIndex(null); } }, [uid]);
  const finish = React.useCallback(async (completed = false) => {
    if (!uid || finishInFlight.current) return;
    finishInFlight.current = true;
    setFinishing(true); setFinishError('');
    try {
      if (auth.currentUser?.uid !== uid) throw new Error('Signed-in account changed');
      await updateDoc(doc(db, 'users', uid), { requesterGuideCompleted: true });
      if (completed) await AsyncStorage.setItem(completionKey(uid), 'true');
      await writes.current.catch(() => {});
      await Promise.allSettled([AsyncStorage.setItem(getTutorialSeenKey(uid), 'true'), AsyncStorage.removeItem(activeKey(uid))]);
    } catch {
      setFinishError('Could not save your guide progress. Please try again.'); setFinishing(false); finishInFlight.current = false; return;
    }
    setStepIndex(null);
    setPendingRoute('');
    setFinishing(false);
    if (completed) {
      setCompletionPending(true);
      if (pathname !== '/requester/r_dashboard') router.replace('/requester/r_dashboard');
    }
    finishInFlight.current = false;
    if (Platform.OS === 'web') {
      const element = startFocus.current?.isConnected ? startFocus.current : targets.current.get(TOUR_STOPS[stepIndex]?.target);
      if (typeof element?.focus === 'function') element.focus();
    }
  }, [uid, stepIndex, pathname, router]);
  React.useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') { event.preventDefault(); finish(false); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, finish]);
  const current = active ? TOUR_STOPS[stepIndex] : null;
  const context = React.useMemo(() => ({ active, completionPending, ready: Boolean(uid && resolvedUid === uid), startTour, registerTarget, registerLeaveGuard, setOrderBlocked, notifyTourScroll, target: current?.target }), [active, completionPending, uid, resolvedUid, startTour, registerTarget, registerLeaveGuard, notifyTourScroll, current?.target]);
  const homeProducts = current?.target === 'home' && pathname === current.route ? targets.current.get('home-products') : null;
  const target = current && pathname === current.route
    ? current.target === 'home' ? homeProducts || targets.current.get('home') : current.target === 'add' ? targets.current.get('add-active') || targets.current.get('add-empty') || targets.current.get('add-nav') : targets.current.get(current.target)
    : null;
  const secondaryTarget = homeProducts ? targets.current.get('home') : null;
  const dismissCompletion = React.useCallback(async () => { try { await AsyncStorage.removeItem(completionKey(uid)); setCompletionPending(false); } catch { /* Keep the message available for retry. */ } }, [uid]);
  return <TourContext.Provider value={context}><View style={styles.root}>{children}{active && !noticesLoading && !noticeOpen ? <RequesterTutorialModal stepIndex={stepIndex} target={target} secondaryTarget={secondaryTarget} homeProducts={!!homeProducts} measureTarget={measureTarget} navigating={!!pendingRoute || finishing} orderBlocked={orderBlocked} error={finishError} onMove={moveTo} onSkip={() => finish(false)} onFinish={() => finish(true)} /> : null}{completionPending && pathname === '/requester/r_dashboard' && !noticeOpen && !noticesLoading ? <TopToastFeedback visible reduceMotion={reduceMotion} message="Guide completed! You can replay it anytime in Settings." onDismiss={dismissCompletion} /> : null}{loadError && !noticeOpen && !noticesLoading ? <View accessibilityRole="alert" style={[styles.loadError, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.textPrimary }}>Could not load your guide progress.</Text><Pressable accessibilityRole="button" onPress={() => { setLoadError(false); setRetryLoad((value) => value + 1); }}><Text style={{ color: colors.iconPrimary }}>Try again</Text></Pressable></View> : null}</View></TourContext.Provider>;
}

export default function RequesterTutorialModal({ stepIndex, target, secondaryTarget, homeProducts, measureTarget, navigating, orderBlocked, error, onMove, onSkip, onFinish }) {
  const { colors } = useBlueTapTheme();
  const { width, height } = useWindowDimensions();
  const [rect, setRect] = React.useState(null);
  const [secondaryRect, setSecondaryRect] = React.useState(null);
  const latestRect = React.useRef(null);
  const latestSecondary = React.useRef(null);
  const shadeRef = React.useRef(null);
  const spotlightRef = React.useRef(null);
  const secondarySpotlightRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const arrowRef = React.useRef(null);
  const [cardHeight, setCardHeight] = React.useState(176);
  const cardHeightRef = React.useRef(cardHeight);
  cardHeightRef.current = cardHeight;
  const [waiting, setWaiting] = React.useState(true);
  const step = TOUR_STOPS[stepIndex];
  const sectionTarget = homeProducts || step.subIndex !== undefined || step.target === 'history-content';
  React.useEffect(() => {
    let mounted = true;
    let frame = null;
    latestRect.current = null;
    latestSecondary.current = null;
    setRect(null);
    setSecondaryRect(null);
    setWaiting(true);
    const waitingTimer = setTimeout(() => setWaiting(false), 1500);
    const node = Platform.OS === 'web' && typeof target?.getScrollableNode === 'function' ? target.getScrollableNode() : target;
    if (Platform.OS === 'web' && step.target !== 'history-content' && typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: sectionTarget ? 'center' : 'nearest', inline: 'nearest', behavior: 'auto' });
    const measure = () => {
      const apply = (x, y, w, h) => {
        if (!mounted) return;
        const raw = [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 && x < width && y < height && x + w > 0 && y + h > 0 ? { x, y, width: w, height: h } : null;
        const next = sectionTarget ? clipTourSection(raw, width, height, cardHeightRef.current) : raw;
        const previous = latestRect.current;
        if (previous === next || (previous && next && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height)) return;
        latestRect.current = next;
        // Keep continuous web scrolling out of React's render cycle. Visibility
        // changes still render normally so the unavailable-target fallback works.
        if (Platform.OS === 'web' && previous && next && shadeRef.current && spotlightRef.current && cardRef.current && arrowRef.current) {
          const placement = tourPlacement(width, height, cardHeightRef.current, next);
          shadeRef.current.setAttribute('d', spotlightPath(spotlightHole(next, width, height), width, height, spotlightHole(latestSecondary.current, width, height)));
          Object.assign(spotlightRef.current.style, { transform: `translate(${next.x - 4}px, ${next.y - 4}px)`, width: `${next.width + 8}px`, height: `${next.height + 8}px` });
          cardRef.current.style.transform = `translate(${placement.left}px, ${placement.top}px)`;
          Object.assign(arrowRef.current.style, { left: `${placement.arrowLeft}px`, top: placement.below ? '-9px' : '', bottom: placement.below ? '' : '-9px', borderTopWidth: placement.below ? '0px' : '9px', borderBottomWidth: placement.below ? '9px' : '0px', borderTopColor: placement.below ? 'transparent' : colors.primary, borderBottomColor: placement.below ? colors.primary : 'transparent' });
        } else setRect(next);
      };
      if (typeof node?.getBoundingClientRect === 'function') { const r = node.getBoundingClientRect(); apply(r.left, r.top, r.width, r.height); }
      else if (typeof target?.measureInWindow === 'function') target.measureInWindow(apply);
      else apply(NaN, NaN, 0, 0);
      const applySecondary = (x, y, w, h) => {
        if (!mounted) return;
        const next = [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 && x < width && y < height && x + w > 0 && y + h > 0 ? { x, y, width: w, height: h } : null;
        const previous = latestSecondary.current;
        if (previous === next || (previous && next && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height)) return;
        latestSecondary.current = next;
        if (Platform.OS === 'web' && previous && next && secondarySpotlightRef.current && shadeRef.current) {
          shadeRef.current.setAttribute('d', spotlightPath(spotlightHole(latestRect.current, width, height), width, height, spotlightHole(next, width, height)));
          Object.assign(secondarySpotlightRef.current.style, { transform: `translate(${next.x - 4}px, ${next.y - 4}px)`, width: `${next.width + 8}px`, height: `${next.height + 8}px` });
        } else setSecondaryRect(next);
      };
      if (typeof secondaryTarget?.getBoundingClientRect === 'function') { const r = secondaryTarget.getBoundingClientRect(); applySecondary(r.left, r.top, r.width, r.height); }
      else if (typeof secondaryTarget?.measureInWindow === 'function') secondaryTarget.measureInWindow(applySecondary);
      else applySecondary(NaN, NaN, 0, 0);
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };
    measureTarget.current = schedule;
    measure();
    let observer;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      if (typeof ResizeObserver !== 'undefined' && node?.nodeType === 1) {
        observer = new ResizeObserver(schedule);
        observer.observe(node);
        if (node.parentElement) observer.observe(node.parentElement);
        if (secondaryTarget?.nodeType === 1) observer.observe(secondaryTarget);
      }
    }
    return () => {
      mounted = false;
      if (measureTarget.current === schedule) measureTarget.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
      }
      clearTimeout(waitingTimer);
    };
  }, [target, secondaryTarget, stepIndex, width, height, sectionTarget, step.target, measureTarget, colors.primary]);
  const displayedRect = rect ? latestRect.current : null;
  const displayedSecondary = secondaryRect ? latestSecondary.current : null;
  const homeStep = step.target === 'home';
  const { cardWidth, left, top, below, arrowLeft } = tourPlacement(width, height, cardHeight, displayedRect);
  const last = stepIndex === TOUR_STOPS.length - 1;
  const hole = spotlightHole(displayedRect, width, height);
  const secondaryHole = spotlightHole(displayedSecondary, width, height);
  const shadePath = spotlightPath(hole, width, height, secondaryHole);
  return <View pointerEvents="box-none" style={styles.overlay}>
    {Platform.OS === 'web' ? <svg aria-hidden="true" focusable="false" width={width} height={height} style={styles.webShade}>
      <path ref={shadeRef} d={shadePath} fill="rgba(3, 17, 36, 0.64)" fillRule="evenodd" />
    </svg> : spotlightShadeRegions([hole, secondaryHole], width, height).map((region, index) => <View key={index} pointerEvents="none" style={[styles.shade, region]} />)}
    {displayedRect ? <View ref={spotlightRef} pointerEvents="none" style={[styles.spotlight, { width: displayedRect.width + 8, height: displayedRect.height + 8, transform: [{ translateX: displayedRect.x - 4 }, { translateY: displayedRect.y - 4 }], borderColor: colors.primaryLight || colors.primary }]} /> : null}
    {displayedSecondary ? <View ref={secondarySpotlightRef} pointerEvents="none" style={[styles.spotlight, { width: displayedSecondary.width + 8, height: displayedSecondary.height + 8, transform: [{ translateX: displayedSecondary.x - 4 }, { translateY: displayedSecondary.y - 4 }], borderColor: colors.primaryLight || colors.primary }]} /> : null}
    <View ref={cardRef} accessibilityRole="summary" accessibilityLiveRegion="polite" onLayout={(event) => { setCardHeight(event.nativeEvent.layout.height); measureTarget.current?.(); }} style={[styles.card, homeStep && styles.homeCard, { transform: [{ translateX: left }, { translateY: top }], width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}>
      {displayedRect ? <View ref={arrowRef} pointerEvents="none" style={[styles.arrow, below ? { top: -9, borderBottomColor: colors.primary, borderBottomWidth: 9 } : { bottom: -9, borderTopColor: colors.primary, borderTopWidth: 9 }, { left: arrowLeft }]} /> : null}
      <View style={styles.heading}><BlueTapIcon name={step.icon} size={22} color={colors.iconPrimary} /><Text style={[styles.step, { color: colors.textSecondary }]}>{`Step ${step.mainIndex + 1} of ${TUTORIAL_STEPS.length}${step.subIndex === undefined ? '' : ` · Order ${step.subIndex + 1}/${ORDER_WALKTHROUGH.length}`}`}</Text><Pressable accessibilityRole="button" accessibilityLabel="Skip tutorial" disabled={navigating} onPress={onSkip} style={[styles.skip, homeStep && styles.homeSkip]}><Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Skip</Text></Pressable></View>
      <Text style={[styles.title, homeStep && styles.homeTitle, { color: colors.textPrimary }]}>{step.title}</Text>
      <Text style={[styles.description, homeStep && styles.homeDescription, { color: colors.textSecondary }]}>{step.description}</Text>
      {orderBlocked && step.subIndex !== undefined ? <Text style={[styles.fallback, { color: colors.textSecondary }]}>You have an active order. You can review this form, but a new request must wait.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.fallback, { color: colors.danger }]}>{error}</Text> : null}
      {!displayedRect ? <Text style={[styles.fallback, { color: colors.textSecondary }]}>{waiting ? 'Finding this control…' : 'This control is unavailable. You can continue or skip.'}</Text> : null}
      <View style={[styles.actions, homeStep && styles.homeActions]}>{stepIndex > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Previous step" disabled={navigating} onPress={() => onMove(stepIndex - 1)} style={styles.back}><Text style={{ color: colors.textPrimary, fontWeight: '700', opacity: navigating ? 0.5 : 1 }}>Back</Text></Pressable> : <View style={styles.spacer} />}<Pressable accessibilityRole="button" accessibilityLabel={last ? 'Finish tutorial' : 'Next step'} disabled={navigating} onPress={() => last ? onFinish() : onMove(stepIndex + 1)} style={[styles.next, { backgroundColor: colors.primaryAction || colors.primary, opacity: navigating ? 0.6 : 1 }]}><Text style={{ color: colors.onPrimary || '#FFFFFF', fontWeight: '800' }}>{last ? 'Finish' : 'Next →'}</Text></Pressable></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  loadError: { position: 'absolute', top: 80, left: 16, right: 16, padding: 12, borderWidth: 1, borderRadius: 10, zIndex: 1100 },
  root: { flex: 1 }, overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  webShade: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
  shade: { position: 'absolute', backgroundColor: 'rgba(3, 17, 36, 0.64)' },
  spotlight: { position: 'absolute', left: 0, top: 0, borderWidth: 3, borderRadius: 12, shadowColor: '#74C7FF', shadowOpacity: 0.9, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
  card: { position: 'absolute', left: 0, top: 0, borderWidth: 1, borderRadius: 14, padding: 12, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  homeCard: { padding: 9 }, homeSkip: { minHeight: 32 }, homeTitle: { marginTop: 1 }, homeDescription: { marginTop: 2, lineHeight: 16 }, homeActions: { marginTop: 4 },
  arrow: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 9, borderRightWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, step: { flex: 1, fontSize: 12, fontWeight: '700' }, skip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 },
  title: { fontSize: 16, fontWeight: '800', marginTop: 3 }, description: { fontSize: 13, lineHeight: 18, marginTop: 4 }, fallback: { fontSize: 12, marginTop: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }, spacer: { flex: 1 }, back: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center' }, next: { minHeight: 40, minWidth: 82, paddingHorizontal: 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
