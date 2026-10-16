import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import {
  BLUETAP_COLORS,
  BLUETAP_DARK_PORTAL_COLORS,
  BLUETAP_LIGHT_PORTAL_COLORS,
} from '../constants/bluetapTheme';
import { useBlueTapTheme } from '../components/BlueTapTheme';
import BlueTapWordmark from '../components/BlueTapWordmark';
import ThemeIconButton from '../components/ThemeIconButton';
import { warmFaceServiceForSignup } from '../services/apiWarmup';
import { prefetchRegistrationPolicy } from '../services/registrationSession';

const BLUE = BLUETAP_COLORS.primary;
const BLUE_DARK = BLUETAP_COLORS.primaryDeep;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const TEXT_DARK = BLUETAP_COLORS.text;
const TEXT_MUTED = BLUETAP_COLORS.muted;
const CONTENT_MAX_WIDTH = 1180;
const DESKTOP_BREAKPOINT = 1024;
const TABLET_BREAKPOINT = 600;
const logo = require('../assets/icons/bluetaplogo.png');
const whiteLogo = require('../assets/icons/bluetapwhitelogo.png');
const prepareSignup = () => prefetchRegistrationPolicy()
  .then((policy) => policy?.faceVerificationRequired === true ? warmFaceServiceForSignup() : null)
  .catch(() => null);

const LIGHT_THEME = {
  surface: BLUETAP_LIGHT_PORTAL_COLORS.surface,
  softSurface: BLUETAP_LIGHT_PORTAL_COLORS.primarySoft,
  card: BLUETAP_LIGHT_PORTAL_COLORS.surface,
  border: BLUETAP_LIGHT_PORTAL_COLORS.border,
  text: BLUETAP_LIGHT_PORTAL_COLORS.textPrimary,
  muted: BLUETAP_LIGHT_PORTAL_COLORS.textSecondary,
  accent: BLUETAP_LIGHT_PORTAL_COLORS.primary,
  footerText: '#526A7F',
};

const DARK_THEME = {
  surface: BLUETAP_DARK_PORTAL_COLORS.background,
  softSurface: BLUETAP_DARK_PORTAL_COLORS.header,
  card: BLUETAP_DARK_PORTAL_COLORS.surface,
  border: BLUETAP_DARK_PORTAL_COLORS.border,
  text: BLUETAP_DARK_PORTAL_COLORS.textPrimary,
  muted: BLUETAP_DARK_PORTAL_COLORS.textSecondary,
  accent: BLUETAP_DARK_PORTAL_COLORS.primaryLight,
  footerText: BLUETAP_DARK_PORTAL_COLORS.textSecondary,
};

const steps = [
  {
    number: '01',
    title: 'Choose Your Water',
    text: 'Browse available water products from your selected water station.',
  },
  {
    number: '02',
    title: 'Send Your Request',
    text: 'Select products, quantities, a container option, and your delivery location.',
  },
  {
    number: '03',
    title: 'Track and Connect',
    text: 'Follow request status and use in-app chat when a conversation is available.',
  },
];

const features = [
  {
    icon: '01',
    title: 'Digital water requests',
    text: 'Choose branch products and send your request from one place.',
  },
  {
    icon: '02',
    title: 'Request tracking',
    text: 'Review current requests, status updates, and request history.',
  },
  {
    icon: '03',
    title: 'Location and distance',
    text: 'Explore provider branches on a map with estimated straight-line distances.',
  },
  {
    icon: '04',
    title: 'In-app communication',
    text: 'Connect with the branch or assigned distributor through order chat.',
  },
  {
    icon: '05',
    title: 'Registration checks',
    text: 'Complete the verification steps required by the current registration policy.',
  },
  {
    icon: '06',
    title: 'Coordinated delivery',
    text: 'Branches review requests and assign deliveries to distributors.',
  },
];

const comparisonRows = [
  ['Messenger orders mixed with personal chats and calls', 'Centralized digital requests for water station branches'],
  ['Handwritten request and delivery lists that are hard to update', 'Organized product, quantity, and delivery information'],
  ['Delivery locations shared through separate conversations', 'Map-based branch locations with estimated straight-line distances'],
  ['Repeated customer follow-ups to check request status', 'Trackable request statuses and delivery progress updates'],
  ['Customer order history scattered across records and messages', 'Accessible request history and in-app order conversations'],
  ['Manual distributor assignments with limited progress visibility', 'Coordinated distributor assignments and delivery scheduling'],
];

function ScrollReveal({ children, delay = 0, reduceMotion = false, style }) {
  const viewRef = useRef(null);
  const progress = useRef(new Animated.Value(1)).current;
  const revealed = useRef(reduceMotion);

  useLayoutEffect(() => {
    if (reduceMotion) {
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }

    if (revealed.current) return undefined;

    if (Platform.OS !== 'web' || typeof IntersectionObserver === 'undefined') {
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }

    const animatedView = viewRef.current;
    const target = animatedView?.getNode?.() || animatedView;
    if (!target || typeof target.nodeType !== 'number') {
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }

    const bounds = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const initiallyVisible = bounds.bottom > 0
      && bounds.top < viewportHeight
      && bounds.right > 0
      && bounds.left < viewportWidth;

    if (initiallyVisible) {
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }

    let animation;
    let observer;
    try {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting || revealed.current) return;
        revealed.current = true;
        observer.unobserve(target);
        observer.disconnect();
        animation = Animated.sequence([
          Animated.delay(delay),
          Animated.timing(progress, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ]);
        animation.start();
      }, { threshold: 0.15 });
    } catch {
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }

    progress.setValue(0);
    try {
      observer.observe(target);
    } catch {
      observer.disconnect();
      revealed.current = true;
      progress.setValue(1);
      return undefined;
    }
    return () => {
      observer.disconnect();
      animation?.stop();
    };
  }, [delay, progress, reduceMotion]);

  const offset = progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View ref={viewRef} style={[style, { opacity: progress, transform: [{ translateY: offset }] }]}>
      {children}
    </Animated.View>
  );
}

function HoverLift({ children, reduceMotion = false, style }) {
  const [hovered, setHovered] = useState(false);
  const lift = hovered && !reduceMotion;

  return (
    <View
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={[
        style,
        lift && styles.hoverLiftActive,
        Platform.OS === 'web' && !reduceMotion && styles.hoverLiftTransition,
      ]}
    >
      {children}
    </View>
  );
}

function ActionButton({
  accessibilityLabel,
  isDark = false,
  label,
  onPress,
  variant = 'primary',
  hoverLift = false,
  reduceMotion = false,
  style,
}) {
  const [hovered, setHovered] = useState(false);
  const lifted = hoverLift && hovered && !reduceMotion;
  const buttonColors =
    variant === 'outline'
      ? isDark
        ? { backgroundColor: '#0E2235', borderColor: '#1C3C55', textColor: '#F5FAFF' }
        : { backgroundColor: '#FFFFFF', borderColor: '#B7DDF7', textColor: BLUE_DARK }
      : variant === 'light'
        ? { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', textColor: BLUE_DARK }
        : variant === 'inverseOutline'
          ? { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.72)', textColor: '#FFFFFF' }
          : {
              backgroundColor: isDark ? '#2186D9' : BLUE,
              borderColor: isDark ? '#2186D9' : BLUE,
              textColor: '#FFFFFF',
            };

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={onPress}
      {...(Platform.OS === 'web' && hoverLift
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : {})}
      style={[
        styles.actionButton,
        style,
        hoverLift && Platform.OS === 'web' && !reduceMotion && styles.hoverLiftTransition,
        lifted && styles.actionButtonHover,
        {
          backgroundColor: buttonColors.backgroundColor,
          borderColor: buttonColors.borderColor,
        },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: buttonColors.textColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Brand({ inverse = false, small = false }) {
  return (
    <View style={styles.brand}>
      <Image
        source={inverse ? whiteLogo : logo}
        style={[styles.brandLogo, small && styles.brandLogoSmall]}
        resizeMode="contain"
      />
      <BlueTapWordmark style={[styles.brandText, inverse && styles.brandTextInverse, small && styles.brandTextSmall]}>
        BlueTap
      </BlueTapWordmark>
    </View>
  );
}

function SectionHeading({ eyebrow, title, text, theme, align = 'left' }) {
  return (
    <View style={[styles.sectionHeading, align === 'center' && styles.sectionHeadingCentered]}>
      {!!eyebrow && <Text style={[styles.eyebrow, { color: theme.accent }]}>{eyebrow}</Text>}
      <Text style={[styles.sectionTitle, { color: theme.text }, align === 'center' && styles.textCentered]}>{title}</Text>
      {!!text && <Text style={[styles.sectionText, { color: theme.muted }, align === 'center' && styles.textCentered]}>{text}</Text>}
    </View>
  );
}

function HeaderLink({ label, onPress, theme, isDark, login = false }) {
  const hoverSurface = isDark
    ? BLUETAP_DARK_PORTAL_COLORS.surfaceElevated
    : BLUETAP_COLORS.primarySoft;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ hovered, focused, pressed }) => [
        login ? styles.loginLinkButton : styles.navLinkButton,
        styles.headerLink,
        {
          backgroundColor: hovered || focused || pressed ? hoverSurface : 'transparent',
          borderColor: focused ? theme.accent : 'transparent',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[login ? styles.loginLinkText : styles.navLink, { color: login ? theme.accent : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PhoneMockup({ isDark = false, reduceMotion = false }) {
  const entranceProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const floatProgress = useRef(new Animated.Value(0)).current;
  const acceptedCardProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const deliveryCardProgress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    let isActive = true;
    const animations = [];

    if (reduceMotion) {
      entranceProgress.setValue(1);
      floatProgress.setValue(0);
      acceptedCardProgress.setValue(1);
      deliveryCardProgress.setValue(1);
      return () => { isActive = false; };
    }

    entranceProgress.setValue(0);
    floatProgress.setValue(0);
    acceptedCardProgress.setValue(0);
    deliveryCardProgress.setValue(0);

    const entrance = Animated.timing(entranceProgress, {
      toValue: 1,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    const acceptedCardEntrance = Animated.sequence([
      Animated.delay(820),
      Animated.timing(acceptedCardProgress, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    const deliveryCardEntrance = Animated.sequence([
      Animated.delay(940),
      Animated.timing(deliveryCardProgress, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    const float = Animated.loop(Animated.sequence([
      Animated.timing(floatProgress, {
        toValue: 1,
        duration: 2500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(floatProgress, {
        toValue: 0,
        duration: 2500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]));

    animations.push(acceptedCardEntrance, deliveryCardEntrance, entrance);
    acceptedCardEntrance.start();
    deliveryCardEntrance.start();
    entrance.start(({ finished }) => {
      if (finished && isActive) {
        animations.push(float);
        float.start();
      }
    });

    return () => {
      isActive = false;
      animations.forEach((animation) => animation.stop());
    };
  }, [acceptedCardProgress, deliveryCardProgress, entranceProgress, floatProgress, reduceMotion]);

  const entranceStyle = {
    opacity: entranceProgress,
    transform: [
      { translateY: entranceProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { scale: entranceProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
    ],
  };
  const floatStyle = {
    transform: [{ translateY: floatProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }],
  };

  return (
    <View style={styles.mockupArea}>
      <View pointerEvents="none" style={[styles.heroOrbLarge, isDark && styles.heroOrbLargeDark]} />
      <View pointerEvents="none" style={[styles.heroOrbSmall, isDark && styles.heroOrbSmallDark]} />

      <Animated.View style={[styles.mockupScene, entranceStyle]}>
        <Animated.View style={[styles.mockupFloatLayer, floatStyle]}>
      <View style={[styles.phoneMockup, isDark && styles.phoneMockupDark]}>
        <View style={styles.phoneTopbar}>
          <View style={styles.phoneBrandMark} />
          <View style={styles.phoneTopLines}>
            <View style={styles.phoneLineLong} />
            <View style={styles.phoneLineShort} />
          </View>
          <View style={styles.phoneAvatar} />
        </View>

        <Text style={[styles.phoneGreeting, isDark && styles.phoneGreetingDark]}>Good morning</Text>
        <Text style={[styles.phoneSubheading, isDark && styles.phoneSubheadingDark]}>Your water, within reach.</Text>
        <Text style={[styles.previewLabel, { color: isDark ? DARK_THEME.muted : LIGHT_THEME.muted }]}>Illustrative request preview</Text>

        <View style={[styles.phoneProductCard, isDark && styles.phoneProductCardDark]}>
          <View style={styles.waterBottle}>
            <View style={styles.bottleCap} />
            <View style={styles.bottleBody} />
          </View>
          <View style={styles.phoneProductCopy}>
            <Text style={[styles.phoneProductTitle, isDark && styles.phoneProductTitleDark]}>Purified Water</Text>
            <Text style={[styles.phoneProductMeta, isDark && styles.phoneProductMetaDark]}>Available at your station</Text>
            <View style={styles.phoneOrderButton}>
              <Text style={styles.phoneOrderButtonText}>Order now</Text>
            </View>
          </View>
        </View>

        <View style={[styles.phoneOrderCard, isDark && styles.phoneOrderCardDark]}>
          <View style={styles.phoneOrderHeader}>
            <Text style={[styles.phoneOrderTitle, isDark && styles.phoneOrderTitleDark]}>Current request</Text>
            <View style={styles.phoneStatusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.phoneStatusText}>Accepted</Text>
            </View>
          </View>
          <View style={styles.deliveryProgress}>
            <View style={styles.deliveryProgressActive} />
          </View>
          <Text style={[styles.deliveryText, isDark && styles.deliveryTextDark]}>Follow updates in your requests.</Text>
        </View>
      </View>

      <Animated.View style={[
        styles.floatingStatus,
        styles.floatingStatusTop,
        isDark && styles.floatingStatusDark,
        {
          opacity: acceptedCardProgress,
          transform: [{ translateY: acceptedCardProgress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}>
        <View style={[styles.floatingIcon, styles.floatingIconBlue]}>
          <Text style={styles.floatingIconText}>✓</Text>
        </View>
        <View>
          <Text style={[styles.floatingStatusTitle, isDark && styles.floatingStatusTitleDark]}>Request accepted</Text>
          <Text style={[styles.floatingStatusText, isDark && styles.floatingStatusTextDark]}>Status updated in your requests</Text>
        </View>
      </Animated.View>

      <Animated.View style={[
        styles.floatingStatus,
        styles.floatingStatusBottom,
        isDark && styles.floatingStatusDark,
        {
          opacity: deliveryCardProgress,
          transform: [{ translateY: deliveryCardProgress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}>
        <View style={[styles.floatingIcon, styles.floatingIconGreen]}>
          <Text style={styles.floatingIconText}>→</Text>
        </View>
        <View>
          <Text style={[styles.floatingStatusTitle, isDark && styles.floatingStatusTitleDark]}>On the way</Text>
          <Text style={[styles.floatingStatusText, isDark && styles.floatingStatusTextDark]}>View the latest delivery status</Text>
        </View>
      </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function DistributorMockup({ isDark = false, isNarrow = false }) {
  return (
    <View style={[styles.distributorMockup, isDark && styles.distributorMockupDark, isNarrow && styles.distributorMockupNarrow]}>
      <View style={[styles.distributorTopbar, isNarrow && styles.distributorTopbarNarrow]}>
        <View>
          <Text style={[styles.distributorKicker, isDark && styles.distributorKickerDark]}>DISTRIBUTOR VIEW · ILLUSTRATIVE</Text>
          <Text style={[styles.distributorTitle, isDark && styles.distributorTitleDark]}>Assigned deliveries</Text>
        </View>
        <View style={[styles.distributorBadge, isNarrow && styles.distributorBadgeNarrow]}>
          <Text style={styles.distributorBadgeText}>Sample view</Text>
        </View>
      </View>

      <View style={[styles.distributorStatsRow, isDark && styles.distributorStatsRowDark]}>
        <View style={styles.distributorStat}>
          <Text style={[styles.distributorWorkflowValue, isDark && styles.distributorWorkflowValueDark]}>01</Text>
          <Text style={[styles.distributorStatLabel, isDark && styles.distributorStatLabelDark]}>Assigned</Text>
        </View>
        <View style={styles.distributorStat}>
          <Text style={[styles.distributorWorkflowValue, isDark && styles.distributorWorkflowValueDark]}>02</Text>
          <Text style={[styles.distributorStatLabel, isDark && styles.distributorStatLabelDark]}>Scheduled</Text>
        </View>
        <View style={styles.distributorStat}>
          <Text style={[styles.distributorWorkflowValue, isDark && styles.distributorWorkflowValueDark]}>03</Text>
          <Text style={[styles.distributorStatLabel, isDark && styles.distributorStatLabelDark]}>Delivered</Text>
        </View>
      </View>

      <View style={styles.distributorRequest}>
        <View style={styles.distributorRequestIcon}>
          <Text style={styles.distributorRequestIconText}>BT</Text>
        </View>
        <View style={styles.distributorRequestCopy}>
          <Text style={[styles.distributorRequestTitle, isDark && styles.distributorRequestTitleDark]}>Assigned water request</Text>
          <Text style={[styles.distributorRequestMeta, isDark && styles.distributorRequestMetaDark]}>Review delivery details</Text>
        </View>
        <View style={styles.distributorRequestPill}>
          <Text style={styles.distributorRequestPillText}>Assigned</Text>
        </View>
      </View>

      <View style={styles.distributorRequest}>
        <View style={[styles.distributorRequestIcon, styles.distributorRequestIconPale]}>
          <Text style={[styles.distributorRequestIconText, styles.distributorRequestIconTextBlue]}>BT</Text>
        </View>
        <View style={styles.distributorRequestCopy}>
          <Text style={[styles.distributorRequestTitle, isDark && styles.distributorRequestTitleDark]}>Scheduled delivery</Text>
          <Text style={[styles.distributorRequestMeta, isDark && styles.distributorRequestMetaDark]}>Delivery time confirmed</Text>
        </View>
        <View style={[styles.distributorRequestPill, styles.distributorRequestPillBlue]}>
          <Text style={styles.distributorRequestPillTextBlue}>Scheduled</Text>
        </View>
      </View>
    </View>
  );
}

function WebLanding({ router, width }) {
  const scrollRef = useRef(null);
  const sectionOffsets = useRef({});
  const { isDark } = useBlueTapTheme();
  const [reduceMotion, setReduceMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
  const themeProgress = useRef(new Animated.Value(isDark ? 1 : 0)).current;
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const isTablet = width >= TABLET_BREAKPOINT && !isDesktop;
  const isNarrow = width < 420;
  const contentPadding = isDesktop ? 42 : isTablet ? 30 : 20;
  const theme = isDark ? DARK_THEME : LIGHT_THEME;
  const openSignup = (role) => {
    prepareSignup();
    router.push(role ? { pathname: '/signup', params: { role } } : '/login?signup=true');
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      themeProgress.setValue(isDark ? 1 : 0);
      return;
    }
    Animated.timing(themeProgress, {
      toValue: isDark ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [isDark, reduceMotion, themeProgress]);

  const transitionColor = useCallback(
    (light, dark) =>
      themeProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [light, dark],
      }),
    [themeProgress]
  );

  const saveSectionOffset = useCallback(
    (section) => (event) => {
      sectionOffsets.current[section] = event.nativeEvent.layout.y;
    },
    []
  );

  const scrollToSection = useCallback((section) => {
    const offset = sectionOffsets.current[section] || 0;
    scrollRef.current?.scrollTo({ y: Math.max(offset - 12, 0), animated: !reduceMotion });
  }, [reduceMotion]);

  const webContentStyle = [
    styles.webContent,
    { paddingHorizontal: contentPadding },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.webSafeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Animated.ScrollView
        ref={scrollRef}
        style={[styles.webScrollView, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}
        contentContainerStyle={styles.webScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.navbar, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface), borderBottomColor: transitionColor('#E7EFF6', DARK_THEME.border) }]}>
          <View style={styles.navbarContent}>
            <Pressable
              accessibilityLabel="BlueTap home"
              accessibilityRole="button"
              onPress={() => scrollToSection('home')}
              style={({ hovered, focused, pressed }) => [
                styles.brandButton,
                { opacity: hovered || pressed ? 0.76 : 1, borderColor: focused ? theme.accent : 'transparent' },
              ]}
            >
              <Brand small={!isDesktop} />
            </Pressable>

            {isDesktop && (
              <View style={styles.navLinks}>
                <HeaderLink label="Home" onPress={() => scrollToSection('home')} theme={theme} isDark={isDark} />
                <HeaderLink label="How It Works" onPress={() => scrollToSection('how')} theme={theme} isDark={isDark} />
                <HeaderLink label="For Distributors" onPress={() => scrollToSection('distributors')} theme={theme} isDark={isDark} />
                <HeaderLink label="About" onPress={() => scrollToSection('about')} theme={theme} isDark={isDark} />
              </View>
            )}

            <View style={styles.navbarActions}>
              <ThemeIconButton style={styles.themeToggleSpacing} />
              {!isNarrow && (
                <HeaderLink label="Log in" onPress={() => router.push('/login')} theme={theme} isDark={isDark} login />
              )}
              <Pressable
                accessibilityLabel="Get Started"
                accessibilityRole="button"
                onPress={() => openSignup()}
                style={({ hovered, focused, pressed }) => [
                  styles.actionButton,
                  styles.navGetStarted,
                  !isDesktop && styles.navGetStartedCompact,
                  {
                    backgroundColor: hovered || pressed
                      ? BLUETAP_COLORS.primaryHover
                      : isDark ? BLUETAP_DARK_PORTAL_COLORS.primary : BLUE,
                    borderColor: focused ? BLUETAP_COLORS.primaryLight : hovered || pressed
                      ? BLUETAP_COLORS.primaryHover
                      : isDark ? BLUETAP_DARK_PORTAL_COLORS.primary : BLUE,
                    borderWidth: focused ? 2 : 1,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <Text style={[styles.actionButtonText, { color: BLUETAP_COLORS.onPrimary }]}>Get Started</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('home')} style={[styles.heroSection, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={[styles.heroContent, !isDesktop && styles.heroContentCompact]}>
            <View style={[styles.heroCopy, !isDesktop && styles.heroCopyCompact]}>
              <View style={[styles.heroBadge, isDark && styles.heroBadgeDark]}>
                <View style={styles.heroBadgeDot} />
                <Text style={[styles.heroBadgeText, isDark && styles.heroBadgeTextDark]}>Fast · Reliable · Local</Text>
              </View>

              <Text style={[styles.heroTitle, { color: theme.text }, !isDesktop && styles.heroTitleCompact]}>
                Clean Water,{"\n"}
                Delivered <Text style={[styles.heroTitleAccent, { color: theme.accent }]}>Within Reach.</Text>
              </Text>

              <Text style={[styles.heroDescription, { color: theme.muted }, !isDesktop && styles.heroDescriptionCompact]}>
                Request purified water from local water stations, manage your delivery details,
                and stay updated on your requests—all in one convenient platform.
              </Text>

              <View style={[styles.heroActions, !isDesktop && styles.heroActionsCompact]}>
                <ActionButton
                  label="Order Water"
                  onPress={() => openSignup('requester')}
                  isDark={isDark}
                  style={!isDesktop && styles.heroActionCompact}
                />
                <ActionButton
                  label="Become a Distributor"
                  onPress={() => openSignup('distributor')}
                  variant="outline"
                  isDark={isDark}
                  style={!isDesktop && styles.heroActionCompact}
                />
              </View>

              <Text style={[styles.heroTrust, { color: theme.muted }]}>
                Local stations · Clear request details · Delivery coordination
              </Text>
            </View>

            <View style={[styles.heroVisual, !isDesktop && styles.heroVisualCompact]}>
              <PhoneMockup isDark={isDark} reduceMotion={reduceMotion} />
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('how')} style={[styles.section, styles.howSection, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={webContentStyle}>
            <SectionHeading
              eyebrow="HOW IT WORKS"
              title="Water requesting made simple"
              text="Choose a station, send your request, and follow its progress."
              theme={theme}
              align="center"
            />
            <View style={[styles.stepGrid, !isDesktop && styles.stepGridCompact]}>
              {steps.map((step, index) => (
                <ScrollReveal
                  key={step.number}
                  delay={index * 100}
                  reduceMotion={reduceMotion}
                  style={[
                    styles.stepCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                    !isDesktop && styles.stepCardCompact,
                    isTablet && styles.stepCardTablet,
                  ]}
                >
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{step.number}</Text>
                  </View>
                  <Text style={[styles.stepTitle, { color: theme.text }]}>{step.title}</Text>
                  <Text style={[styles.stepText, { color: theme.muted }]}>{step.text}</Text>
                </ScrollReveal>
              ))}
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('about')} style={[styles.section, styles.featureSection, { backgroundColor: transitionColor(LIGHT_THEME.softSurface, DARK_THEME.softSurface) }]}>
          <View style={webContentStyle}>
            <SectionHeading
              eyebrow="WHY BLUETAP"
              title="Why choose BlueTap?"
              text="Useful tools for requesting water and coordinating local delivery."
              theme={theme}
              align="center"
            />
            <View style={[styles.featureGrid, !isDesktop && styles.featureGridCompact]}>
              {features.map((feature, index) => (
                <ScrollReveal
                  key={feature.title}
                  delay={index * 80}
                  reduceMotion={reduceMotion}
                  style={[styles.featureCard, !isDesktop && styles.featureCardCompact]}
                >
                  <View style={[styles.featureIcon, isDark && styles.featureIconDark]}>
                    <Text style={[styles.featureIconText, isDark && styles.featureIconTextDark]}>{feature.icon}</Text>
                  </View>
                  <View style={styles.featureCopy}>
                    <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                    <Text style={[styles.featureText, { color: theme.muted }]}>{feature.text}</Text>
                  </View>
                </ScrollReveal>
              ))}
            </View>
          </View>
        </Animated.View>

        <Animated.View style={[styles.section, styles.comparisonSection, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={webContentStyle}>
            <SectionHeading
              eyebrow="BETTER WATER REQUESTS"
              title="From Manual Requests to Smarter Water Delivery"
              text="See how BlueTap brings water requests, customer communication, and delivery coordination into one organized platform."
              theme={theme}
              align="center"
            />
            <View style={[styles.comparisonGrid, !isDesktop && styles.comparisonGridCompact]}>
              <HoverLift reduceMotion={reduceMotion} style={isDesktop ? styles.comparisonHoverDesktop : styles.comparisonHoverCompact}>
                <ScrollReveal reduceMotion={reduceMotion} style={styles.comparisonReveal}>
                  <View style={[styles.comparisonCard, isDesktop ? styles.comparisonCardDesktop : styles.comparisonCardCompact, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <Text style={[styles.comparisonCardTitle, { color: theme.text }]}>Manual Station Operations</Text>
                    {comparisonRows.map(([manual], index) => (
                      <ScrollReveal key={manual} delay={index * 65} reduceMotion={reduceMotion} style={styles.comparisonRow}>
                        <View style={[styles.comparisonIcon, { backgroundColor: isDark ? BLUETAP_DARK_PORTAL_COLORS.dangerSoft : BLUETAP_COLORS.dangerSoft }]}>
                          <Text style={[styles.comparisonIconText, { color: isDark ? BLUETAP_DARK_PORTAL_COLORS.danger : BLUETAP_COLORS.danger }]}>×</Text>
                        </View>
                        <Text style={[styles.comparisonRowText, { color: theme.text }]}>{manual}</Text>
                      </ScrollReveal>
                    ))}
                  </View>
                </ScrollReveal>
              </HoverLift>
              <HoverLift reduceMotion={reduceMotion} style={isDesktop ? styles.comparisonHoverDesktop : styles.comparisonHoverCompact}>
                <ScrollReveal reduceMotion={reduceMotion} style={styles.comparisonReveal}>
                  <LinearGradient
                    colors={[BLUE_DARK, BLUE]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.comparisonCard, styles.bluetapCard, isDesktop ? styles.comparisonCardDesktop : styles.comparisonCardCompact]}
                  >
                    <Text style={[styles.comparisonCardTitle, styles.comparisonCardTitleInverse]}>With BlueTap</Text>
                    {comparisonRows.map(([, digital], index) => (
                      <ScrollReveal key={digital} delay={index * 65} reduceMotion={reduceMotion} style={styles.comparisonRow}>
                        <View style={[styles.comparisonIcon, styles.comparisonIconPositive]}>
                          <Text style={styles.comparisonIconPositiveText}>✓</Text>
                        </View>
                        <Text style={[styles.comparisonRowText, styles.comparisonRowTextInverse]}>{digital}</Text>
                      </ScrollReveal>
                    ))}
                  </LinearGradient>
                </ScrollReveal>
              </HoverLift>
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('distributors')} style={[styles.section, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={[webContentStyle, styles.distributorSection, !isDesktop && styles.distributorSectionCompact]}>
            <ScrollReveal reduceMotion={reduceMotion} style={[styles.distributorVisual, !isDesktop && styles.distributorVisualCompact]}>
              <DistributorMockup isDark={isDark} isNarrow={isNarrow} />
            </ScrollReveal>
            <ScrollReveal reduceMotion={reduceMotion} style={[styles.distributorCopy, !isDesktop && styles.distributorCopyCompact]}>
              <SectionHeading
                eyebrow="FOR WATER DISTRIBUTORS"
                title="Keep assigned deliveries organized"
                text="Review branch assignments, schedule deliveries, and update their progress from your distributor workspace."
                theme={theme}
              />
              <View style={styles.checkList}>
                {[
                  'Review and accept branch assignments',
                  'Schedule and update deliveries',
                  'View delivery history and order chat',
                ].map((item, index) => (
                  <ScrollReveal key={item} delay={index * 100} reduceMotion={reduceMotion} style={styles.checkItem}>
                    <View style={styles.checkIcon}>
                      <Text style={styles.checkIconText}>✓</Text>
                    </View>
                    <Text style={[styles.checkText, { color: theme.text }]}>{item}</Text>
                  </ScrollReveal>
                ))}
              </View>
              <ActionButton
                label="Apply as Distributor"
                onPress={() => openSignup('distributor')}
                isDark={isDark}
                hoverLift
                reduceMotion={reduceMotion}
                style={styles.distributorAction}
              />
            </ScrollReveal>
          </View>
        </Animated.View>

        <Animated.View style={[styles.ctaSection, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <ScrollReveal reduceMotion={reduceMotion} style={styles.ctaReveal}>
            <LinearGradient
              colors={[BLUE_DARK, '#2B9CE5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.ctaBanner, !isDesktop && styles.ctaBannerCompact]}
            >
              <View style={styles.ctaCopy}>
                <Text style={[styles.ctaTitle, !isDesktop && styles.ctaTitleCompact]}>
                  Ready to make water ordering easier?
                </Text>
                <Text style={styles.ctaText}>
                  Join BlueTap for simpler water ordering and delivery.
                </Text>
              </View>
              <View style={[styles.ctaActions, !isDesktop && styles.ctaActionsCompact]}>
                <ActionButton
                  label="Get Started"
                  onPress={() => openSignup()}
                  variant="light"
                  hoverLift
                  reduceMotion={reduceMotion}
                  style={!isDesktop && styles.ctaActionCompact}
                />
                <ActionButton
                  label="Log In"
                  onPress={() => router.push('/login')}
                  variant="inverseOutline"
                  hoverLift
                  reduceMotion={reduceMotion}
                  style={!isDesktop && styles.ctaActionCompact}
                />
              </View>
            </LinearGradient>
          </ScrollReveal>
        </Animated.View>

        <Animated.View style={[styles.footer, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={[styles.footerContent, !isDesktop && styles.footerContentCompact]}>
            <View style={styles.footerBrandBlock}>
              <Brand />
              <Text style={[styles.footerTagline, { color: theme.muted }]}>Water Within Reach</Text>
            </View>
            <View style={[styles.footerLinks, !isDesktop && styles.footerLinksCompact]}>
              <TouchableOpacity onPress={() => scrollToSection('home')}><Text style={[styles.footerLink, { color: theme.footerText }]}>Home</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => scrollToSection('how')}><Text style={[styles.footerLink, { color: theme.footerText }]}>How It Works</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => scrollToSection('distributors')}><Text style={[styles.footerLink, { color: theme.footerText }]}>For Distributors</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/login')}><Text style={[styles.footerLink, { color: theme.footerText }]}>Login</Text></TouchableOpacity>
            </View>
          </View>
          <View style={[styles.footerDivider, { backgroundColor: theme.border }]} />
          <Text style={[styles.copyright, { color: theme.muted }]}>© 2026 BlueTap. All rights reserved.</Text>
        </Animated.View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function NativeLanding({ router, width }) {
  const isSmallPhone = width < 360;
  const openSignup = () => {
    prepareSignup();
    router.push('/login?signup=true');
  };

  return (
    <SafeAreaView style={styles.nativeSafeArea}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[BLUE_DARK, BLUE, '#42A5F5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.nativeGradient}
      >
        <ScrollView
          contentContainerStyle={[styles.nativeScrollContent, isSmallPhone && styles.nativeScrollContentSmall]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.nativeBrandRow}>
            <Brand inverse />
          </View>
          <View style={styles.nativeHeroMark}>
            <View style={styles.nativeHeroHalo}>
              <Image source={whiteLogo} style={styles.nativeHeroLogo} resizeMode="contain" />
            </View>
          </View>
          <Text style={[styles.nativeTitle, isSmallPhone && styles.nativeTitleSmall]}>
            Clean Water,{"\n"}Within Reach.
          </Text>
          <Text style={styles.nativeDescription}>
            Order purified water in a few simple steps.
          </Text>

          <View style={styles.nativeActions}>
            <ActionButton
              label="Get Started"
              onPress={openSignup}
              variant="light"
              style={styles.nativeActionButton}
            />
            <ActionButton
              label="Log In"
              onPress={() => router.push('/login')}
              variant="inverseOutline"
              style={styles.nativeActionButton}
            />
          </View>

          <View style={styles.nativeSteps}>
            <Text style={styles.nativeStepsTitle}>Water ordering made simple</Text>
            {steps.map((step) => (
              <View key={step.number} style={styles.nativeStep}>
                <View style={styles.nativeStepNumber}>
                  <Text style={styles.nativeStepNumberText}>{step.number}</Text>
                </View>
                <View style={styles.nativeStepCopy}>
                  <Text style={styles.nativeStepTitle}>{step.title}</Text>
                  <Text style={styles.nativeStepText}>{step.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  useEffect(() => { prepareSignup(); }, []);

  if (Platform.OS !== 'web') {
    return <NativeLanding router={router} width={width} />;
  }

  return <WebLanding router={router} width={width} />;
}

const styles = StyleSheet.create({
  webSafeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  webScrollView: { flex: 1, backgroundColor: '#FFFFFF' },
  webScrollContent: { flexGrow: 1 },
  webContent: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  navbar: {
    width: '100%',
    minHeight: 76,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E7EFF6',
  },
  navbarContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    minHeight: 76,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  brandLogo: { width: 38, height: 38, marginRight: 9 },
  brandLogoSmall: { width: 31, height: 31, marginRight: 7 },
  brandText: { color: BLUE, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  brandTextSmall: { fontSize: 20 },
  brandTextInverse: { color: '#FFFFFF' },
  navLinks: { flexDirection: 'row', alignItems: 'center', marginLeft: 40, marginRight: 22 },
  navLinkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  navLink: { color: '#41566D', fontSize: 14, fontWeight: '700' },
  navbarActions: { flexDirection: 'row', alignItems: 'center' },
  loginLinkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  loginLinkText: { color: BLUE_DARK, fontSize: 14, fontWeight: '800' },
  headerLink: { borderWidth: 1, borderRadius: 10 },
  actionButton: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionButtonHover: { transform: [{ translateY: -2 }], shadowColor: '#12304A', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 4 },
  hoverLiftActive: { transform: [{ translateY: -3 }], shadowColor: '#12304A', shadowOffset: { width: 0, height: 11 }, shadowOpacity: 0.14, shadowRadius: 24, elevation: 5 },
  hoverLiftTransition: { transitionProperty: 'transform, box-shadow', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' },
  actionButtonPrimary: { backgroundColor: BLUE, borderColor: BLUE },
  actionButtonPrimaryDark: { backgroundColor: '#2196DB', borderColor: '#2196DB' },
  actionButtonOutline: { backgroundColor: '#FFFFFF', borderColor: '#B7DDF7' },
  actionButtonOutlineDark: { backgroundColor: '#142A40', borderColor: '#4D91BC' },
  actionButtonLight: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  actionButtonInverseOutline: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.72)' },
  actionButtonText: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  actionButtonTextPrimary: { color: '#FFFFFF' },
  actionButtonTextOutline: { color: BLUE_DARK },
  actionButtonTextOutlineDark: { color: '#D7F1FF' },
  actionButtonTextLight: { color: BLUE_DARK },
  actionButtonTextInverseOutline: { color: '#FFFFFF' },
  navGetStarted: { minHeight: 42, borderRadius: 11, paddingHorizontal: 17 },
  navGetStartedCompact: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
  themeToggleSpacing: { marginRight: 8 },
  heroSection: { width: '100%', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  heroContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    minHeight: 600,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 72,
    paddingBottom: 82,
  },
  heroContentCompact: { minHeight: 0, flexDirection: 'column', paddingTop: 52, paddingBottom: 56 },
  heroCopy: { flex: 1, maxWidth: 570, paddingRight: 32 },
  heroCopyCompact: { width: '100%', maxWidth: 620, paddingRight: 0, alignSelf: 'center' },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E9F6FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 20,
  },
  heroBadgeDark: { backgroundColor: '#112A40', borderWidth: 1, borderColor: '#1C3C55' },
  heroBadgeDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#2BA6E8', marginRight: 7 },
  heroBadgeText: { color: BLUE_DARK, fontSize: 13, fontWeight: '800' },
  heroBadgeTextDark: { color: '#70BDF2' },
  heroTitle: { color: TEXT_DARK, fontSize: 60, lineHeight: 67, fontWeight: '800', letterSpacing: -1.8 },
  heroTitleCompact: { fontSize: 38, lineHeight: 44, letterSpacing: -1 },
  heroTitleAccent: { color: BLUE },
  heroDescription: { maxWidth: 510, color: TEXT_MUTED, fontSize: 18, lineHeight: 29, marginTop: 22 },
  heroDescriptionCompact: { fontSize: 16, lineHeight: 25, marginTop: 17 },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 32 },
  heroActionsCompact: { width: '100%', flexDirection: 'column', alignItems: 'stretch', gap: 0, marginTop: 25 },
  heroActionCompact: { width: '100%', marginBottom: 12 },
  heroTrust: { color: '#70869B', fontSize: 13, fontWeight: '700', marginTop: 18 },
  heroVisual: { flex: 1, minWidth: 0, alignItems: 'flex-end', justifyContent: 'center' },
  heroVisualCompact: { width: '100%', alignItems: 'center', marginTop: 34 },
  mockupArea: { width: '100%', maxWidth: 510, height: 456, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  mockupScene: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  mockupFloatLayer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  heroOrbLarge: { position: 'absolute', width: 388, height: 388, borderRadius: 194, backgroundColor: '#DDF3FF', right: 24, top: 28 },
  heroOrbSmall: { position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: '#9DDBFA', left: 12, bottom: 36 },
  heroOrbLargeDark: { backgroundColor: '#0E2235', borderWidth: 1, borderColor: '#1C3C55' },
  heroOrbSmallDark: { backgroundColor: '#163B59' },
  phoneMockup: { width: 264, borderRadius: 27, backgroundColor: '#FFFFFF', padding: 16, zIndex: 2, shadowColor: '#075D9D', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.19, shadowRadius: 24, elevation: 10 },
  phoneMockupDark: { backgroundColor: '#0E2235', borderWidth: 1, borderColor: '#1C3C55', shadowColor: '#000000', shadowOpacity: 0.32 },
  phoneTopbar: { flexDirection: 'row', alignItems: 'center', marginBottom: 17 },
  phoneBrandMark: { width: 28, height: 28, borderRadius: 14, backgroundColor: BLUE },
  phoneTopLines: { flex: 1, marginLeft: 9 },
  phoneLineLong: { width: 70, height: 6, borderRadius: 999, backgroundColor: '#D1E8F8' },
  phoneLineShort: { width: 44, height: 4, borderRadius: 999, backgroundColor: '#E5F2FA', marginTop: 5 },
  phoneAvatar: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#BDE5FA' },
  phoneGreeting: { color: '#6C8499', fontSize: 10, fontWeight: '700' },
  phoneSubheading: { color: TEXT_DARK, fontSize: 15, fontWeight: '800', marginTop: 3 },
  previewLabel: { fontSize: 9, fontWeight: '700', marginTop: 5 },
  phoneProductCard: { flexDirection: 'row', backgroundColor: '#F0F9FF', borderRadius: 16, padding: 12, marginTop: 14 },
  phoneGreetingDark: { color: '#9FB4C8' },
  phoneSubheadingDark: { color: '#F5FAFF' },
  phoneProductCardDark: { backgroundColor: '#112A40' },
  waterBottle: { width: 52, height: 68, alignItems: 'center', justifyContent: 'center' },
  bottleCap: { width: 16, height: 9, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#6CC3EF', marginBottom: -1 },
  bottleBody: { width: 37, height: 49, borderRadius: 12, borderWidth: 4, borderColor: '#47A9DE', backgroundColor: '#CBEFFF' },
  phoneProductCopy: { flex: 1, marginLeft: 8 },
  phoneProductTitle: { color: TEXT_DARK, fontSize: 12, fontWeight: '800' },
  phoneProductTitleDark: { color: '#F5FAFF' },
  phoneProductMeta: { color: TEXT_MUTED, fontSize: 9, fontWeight: '700', marginTop: 4 },
  phoneProductMetaDark: { color: BLUETAP_DARK_PORTAL_COLORS.textSecondary },
  phoneOrderButton: { backgroundColor: BLUE, borderRadius: 8, marginTop: 8, paddingVertical: 6, alignItems: 'center' },
  phoneOrderButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  phoneOrderCard: { borderWidth: 1, borderColor: '#E0EEF7', borderRadius: 15, padding: 12, marginTop: 13 },
  phoneOrderCardDark: { borderColor: '#1C3C55', backgroundColor: '#0A1928' },
  phoneOrderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phoneOrderTitle: { color: TEXT_DARK, fontSize: 11, fontWeight: '800' },
  phoneOrderTitleDark: { color: '#F5FAFF' },
  phoneStatusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E7F9EF', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  statusDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#22A45D', marginRight: 4 },
  phoneStatusText: { color: '#168448', fontSize: 8, fontWeight: '800' },
  deliveryProgress: { height: 5, borderRadius: 999, backgroundColor: '#E7F1F7', marginTop: 12, overflow: 'hidden' },
  deliveryProgressActive: { width: '62%', height: '100%', borderRadius: 999, backgroundColor: '#55B9E9' },
  deliveryText: { color: '#778EA1', fontSize: 8, lineHeight: 12, fontWeight: '600', marginTop: 8 },
  deliveryTextDark: { color: '#9FB4C8' },
  floatingStatus: { position: 'absolute', zIndex: 3, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 13, padding: 10, shadowColor: '#286A95', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 5 },
  floatingStatusDark: { backgroundColor: '#0E2235', borderWidth: 1, borderColor: '#1C3C55', shadowColor: '#000000', shadowOpacity: 0.28 },
  floatingStatusTop: { top: 64, right: 0 },
  floatingStatusBottom: { bottom: 51, left: 0 },
  floatingIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  floatingIconBlue: { backgroundColor: '#E4F4FF' },
  floatingIconGreen: { backgroundColor: '#E6F8ED' },
  floatingIconText: { color: BLUE_DARK, fontSize: 15, fontWeight: '900' },
  floatingStatusTitle: { color: TEXT_DARK, fontSize: 10, fontWeight: '800' },
  floatingStatusText: { color: TEXT_MUTED, fontSize: 8, fontWeight: '600', marginTop: 3 },
  floatingStatusTitleDark: { color: '#F5FAFF' },
  floatingStatusTextDark: { color: '#9FB4C8' },
  section: { width: '100%', paddingTop: 80, paddingBottom: 80 },
  howSection: { backgroundColor: '#FFFFFF' },
  featureSection: { backgroundColor: BLUE_LIGHT },
  sectionHeading: { maxWidth: 630, marginBottom: 38 },
  sectionHeadingCentered: { alignSelf: 'center', alignItems: 'center' },
  eyebrow: { color: BLUE, fontSize: 12, fontWeight: '900', letterSpacing: 1.35, marginBottom: 11 },
  sectionTitle: { color: TEXT_DARK, fontSize: 36, lineHeight: 43, fontWeight: '800', letterSpacing: -0.7 },
  sectionText: { color: TEXT_MUTED, fontSize: 16, lineHeight: 25, marginTop: 12 },
  textCentered: { textAlign: 'center' },
  stepGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  stepGridCompact: { flexWrap: 'wrap' },
  stepCard: { width: '31.5%', minHeight: 220, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E4EEF5', padding: 24, shadowColor: '#345A78', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 15, elevation: 2 },
  stepCardCompact: { width: '100%', marginBottom: 12 },
  stepCardTablet: { width: '48.5%' },
  stepNumber: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F5FF', marginBottom: 22 },
  stepNumberText: { color: BLUE_DARK, fontSize: 13, fontWeight: '900' },
  stepTitle: { color: TEXT_DARK, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  stepText: { color: TEXT_MUTED, fontSize: 14, lineHeight: 22, marginTop: 9 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  featureGridCompact: {},
  featureCard: { width: '50%', flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 18 },
  featureCardCompact: { width: '100%', paddingHorizontal: 0, paddingVertical: 14 },
  featureIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDF2FF', marginRight: 15 },
  featureIconDark: { backgroundColor: '#163B59' },
  featureIconText: { color: BLUE_DARK, fontSize: 22, fontWeight: '900' },
  featureIconTextDark: { color: BLUETAP_DARK_PORTAL_COLORS.primaryLight },
  featureCopy: { flex: 1, paddingRight: 16 },
  featureTitle: { color: TEXT_DARK, fontSize: 17, fontWeight: '800' },
  featureText: { color: TEXT_MUTED, fontSize: 14, lineHeight: 21, marginTop: 6 },
  comparisonSection: { paddingTop: 82, paddingBottom: 88 },
  comparisonGrid: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  comparisonGridCompact: { flexDirection: 'column', gap: 16 },
  comparisonHoverDesktop: { flex: 1, minWidth: 0 },
  comparisonHoverCompact: { width: '100%' },
  comparisonReveal: { width: '100%', flex: 1 },
  comparisonCard: { minWidth: 0, borderRadius: 20, padding: 30, borderWidth: 1, shadowColor: '#12304A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 3 },
  comparisonCardDesktop: { flex: 1 },
  comparisonCardCompact: { width: '100%', padding: 22 },
  bluetapCard: { borderColor: BLUE_DARK },
  comparisonCardTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', marginBottom: 17, flexShrink: 1 },
  comparisonCardTitleInverse: { color: BLUETAP_COLORS.onPrimary },
  comparisonRow: { minHeight: 52, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9 },
  comparisonIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  comparisonIconText: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  comparisonIconPositive: { backgroundColor: '#E3F7EC' },
  comparisonIconPositiveText: { color: BLUETAP_COLORS.success, fontSize: 15, fontWeight: '900' },
  comparisonRowText: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  comparisonRowTextInverse: { color: BLUETAP_COLORS.onPrimary },
  distributorSection: { flexDirection: 'row', alignItems: 'center' },
  distributorSectionCompact: { flexDirection: 'column' },
  distributorVisual: { flex: 1, paddingRight: 64 },
  distributorVisualCompact: { width: '100%', paddingRight: 0, marginBottom: 42 },
  distributorCopy: { flex: 1, maxWidth: 510 },
  distributorCopyCompact: { width: '100%', maxWidth: 620 },
  distributorMockup: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: '#DCECF7', padding: 22, shadowColor: '#286A95', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 6 },
  distributorMockupNarrow: { padding: 16 },
  distributorMockupDark: { backgroundColor: '#0E2235', borderColor: '#1C3C55', shadowColor: '#000000', shadowOpacity: 0.28 },
  distributorTopbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  distributorTopbarNarrow: { flexDirection: 'column', alignItems: 'flex-start' },
  distributorKicker: { color: BLUE, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  distributorKickerDark: { color: BLUETAP_DARK_PORTAL_COLORS.primaryLight },
  distributorTitle: { color: TEXT_DARK, fontSize: 20, fontWeight: '800', marginTop: 5 },
  distributorTitleDark: { color: '#F5FAFF' },
  distributorBadge: { backgroundColor: '#E8F8EE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  distributorBadgeNarrow: { marginTop: 10 },
  distributorBadgeText: { color: BLUETAP_COLORS.success, fontSize: 11, fontWeight: '800' },
  distributorStatsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F2FAFF', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 10, marginTop: 22 },
  distributorStatsRowDark: { backgroundColor: '#112A40' },
  distributorStat: { flex: 1, alignItems: 'center' },
  distributorWorkflowValue: { color: BLUE_DARK, fontSize: 18, fontWeight: '900' },
  distributorWorkflowValueDark: { color: BLUETAP_DARK_PORTAL_COLORS.primaryLight },
  distributorStatLabel: { color: TEXT_MUTED, fontSize: 10, fontWeight: '700', marginTop: 4 },
  distributorStatLabelDark: { color: '#9FB4C8' },
  distributorRequest: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#E9F0F5' },
  distributorRequestIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE, marginRight: 11 },
  distributorRequestIconPale: { backgroundColor: '#DDF2FF' },
  distributorRequestIconText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  distributorRequestIconTextBlue: { color: BLUE_DARK },
  distributorRequestCopy: { flex: 1, minWidth: 0 },
  distributorRequestTitle: { color: TEXT_DARK, fontSize: 12, fontWeight: '800' },
  distributorRequestTitleDark: { color: BLUETAP_DARK_PORTAL_COLORS.textPrimary },
  distributorRequestMeta: { color: TEXT_MUTED, fontSize: 10, fontWeight: '600', marginTop: 4 },
  distributorRequestMetaDark: { color: BLUETAP_DARK_PORTAL_COLORS.textSecondary },
  distributorRequestPill: { backgroundColor: '#FFF5D9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 8 },
  distributorRequestPillBlue: { backgroundColor: '#E4F4FF' },
  distributorRequestPillText: { color: BLUETAP_COLORS.warningAction, fontSize: 9, fontWeight: '800' },
  distributorRequestPillTextBlue: { color: BLUE_DARK, fontSize: 9, fontWeight: '800' },
  checkList: { marginTop: 4, marginBottom: 25 },
  checkItem: { flexDirection: 'row', alignItems: 'center', marginTop: 13 },
  checkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3F8ED', marginRight: 10 },
  checkIconText: { color: '#16884B', fontSize: 12, fontWeight: '900' },
  checkText: { color: '#425A70', fontSize: 15, fontWeight: '700' },
  distributorAction: { alignSelf: 'flex-start' },
  ctaSection: { width: '100%', backgroundColor: '#FFFFFF', paddingTop: 4, paddingBottom: 88 },
  ctaReveal: { width: '100%' },
  ctaBanner: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', minHeight: 220, borderRadius: 24, paddingHorizontal: 54, paddingVertical: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  ctaBannerCompact: { minHeight: 0, paddingHorizontal: 25, paddingVertical: 31, flexDirection: 'column', alignItems: 'stretch' },
  ctaCopy: { flex: 1, maxWidth: 610 },
  ctaTitle: { color: '#FFFFFF', fontSize: 33, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  ctaTitleCompact: { fontSize: 27, lineHeight: 34 },
  ctaText: { color: '#DDF4FF', fontSize: 16, lineHeight: 24, marginTop: 10 },
  ctaActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 30 },
  ctaActionsCompact: { width: '100%', flexDirection: 'column', alignItems: 'stretch', gap: 0, marginLeft: 0, marginTop: 25 },
  ctaActionCompact: { width: '100%', marginBottom: 11 },
  footer: { width: '100%', backgroundColor: '#FFFFFF', paddingBottom: 30 },
  footerContent: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 30 },
  footerContentCompact: { flexDirection: 'column', alignItems: 'flex-start' },
  footerBrandBlock: {},
  footerTagline: { color: TEXT_MUTED, fontSize: 13, fontWeight: '600', marginTop: 7 },
  footerLinks: { flexDirection: 'row', alignItems: 'center' },
  footerLinksCompact: { flexWrap: 'wrap', marginTop: 24, marginBottom: -8 },
  footerLink: { color: '#526A7F', fontSize: 14, fontWeight: '700', marginLeft: 22 },
  footerDivider: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', height: 1, backgroundColor: '#E7EFF6' },
  copyright: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', color: '#879AAC', fontSize: 12, fontWeight: '600', marginTop: 20 },
  nativeSafeArea: { flex: 1, backgroundColor: BLUE_DARK },
  nativeGradient: { flex: 1 },
  nativeScrollContent: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 18, paddingBottom: 36 },
  nativeScrollContentSmall: { paddingHorizontal: 20, paddingTop: 12 },
  nativeBrandRow: { alignItems: 'flex-start' },
  nativeHeroMark: { alignItems: 'center', marginTop: 34 },
  nativeHeroHalo: { width: 135, height: 135, borderRadius: 68, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  nativeHeroLogo: { width: 88, height: 88 },
  nativeTitle: { color: '#FFFFFF', fontSize: 39, lineHeight: 46, textAlign: 'center', fontWeight: '800', letterSpacing: -1, marginTop: 31 },
  nativeTitleSmall: { fontSize: 34, lineHeight: 40, marginTop: 24 },
  nativeDescription: { color: '#DDF3FF', fontSize: 16, lineHeight: 25, textAlign: 'center', marginTop: 15, paddingHorizontal: 8 },
  nativeActions: { marginTop: 28 },
  nativeActionButton: { width: '100%', marginBottom: 12 },
  nativeSteps: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)', borderRadius: 21, padding: 18, marginTop: 22 },
  nativeStepsTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginBottom: 7 },
  nativeStep: { flexDirection: 'row', paddingTop: 15 },
  nativeStepNumber: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', marginRight: 11 },
  nativeStepNumberText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  nativeStepCopy: { flex: 1 },
  nativeStepTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  nativeStepText: { color: '#D5F1FF', fontSize: 12, lineHeight: 17, marginTop: 3 },
});
