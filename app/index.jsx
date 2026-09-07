import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Platform,
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

const BLUE = '#187BCD';
const BLUE_DARK = '#0B5FA8';
const BLUE_LIGHT = '#EEF8FF';
const TEXT_DARK = '#172033';
const TEXT_MUTED = '#64748B';
const CONTENT_MAX_WIDTH = 1180;
const DESKTOP_BREAKPOINT = 1024;
const TABLET_BREAKPOINT = 600;
const logo = require('../assets/icons/bluetaplogo.png');
const whiteLogo = require('../assets/icons/bluetapwhitelogo.png');

const LIGHT_THEME = {
  surface: '#FFFFFF',
  softSurface: BLUE_LIGHT,
  card: '#FFFFFF',
  border: '#E4EEF5',
  text: TEXT_DARK,
  muted: TEXT_MUTED,
  accent: BLUE,
  footerText: '#526A7F',
};

const DARK_THEME = {
  surface: '#0D1927',
  softSurface: '#102842',
  card: '#142A40',
  border: '#294862',
  text: '#F3F8FC',
  muted: '#AEC4D5',
  accent: '#51BDF4',
  footerText: '#C2D5E3',
};

const steps = [
  {
    number: '01',
    title: 'Choose Your Water',
    text: 'Browse available products from participating water stations.',
  },
  {
    number: '02',
    title: 'Send Your Request',
    text: 'Choose your quantity, container, station, and delivery date.',
  },
  {
    number: '03',
    title: 'Track Your Order',
    text: 'Stay updated as your request moves from the station to your doorstep.',
  },
];

const features = [
  {
    icon: '✓',
    title: 'Convenient Ordering',
    text: 'Request water anytime without visiting the station.',
  },
  {
    icon: '⌂',
    title: 'Trusted Local Stations',
    text: 'Connect with participating water providers in your area.',
  },
  {
    icon: '≡',
    title: 'Clear Order Details',
    text: 'See your products, quantities, costs, and delivery information.',
  },
  {
    icon: '+',
    title: 'Built for Communities',
    text: 'BlueTap helps connect households and local water distributors.',
  },
];

function ActionButton({
  accessibilityLabel,
  isDark = false,
  label,
  onPress,
  variant = 'primary',
  style,
}) {
  const buttonColors =
    variant === 'outline'
      ? isDark
        ? { backgroundColor: '#142A40', borderColor: '#4D91BC', textColor: '#D7F1FF' }
        : { backgroundColor: '#FFFFFF', borderColor: '#B7DDF7', textColor: BLUE_DARK }
      : variant === 'light'
        ? { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', textColor: BLUE_DARK }
        : variant === 'inverseOutline'
          ? { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.72)', textColor: '#FFFFFF' }
          : {
              backgroundColor: isDark ? '#2196DB' : '#187BCD',
              borderColor: isDark ? '#2196DB' : '#187BCD',
              textColor: '#FFFFFF',
            };

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel || label}
      accessibilityRole="button"
      activeOpacity={0.82}
      onPress={onPress}
      style={[
        styles.actionButton,
        style,
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
      <Text style={[styles.brandText, inverse && styles.brandTextInverse, small && styles.brandTextSmall]}>
        BlueTap
      </Text>
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

function PhoneMockup() {
  return (
    <View style={styles.mockupArea}>
      <View pointerEvents="none" style={styles.heroOrbLarge} />
      <View pointerEvents="none" style={styles.heroOrbSmall} />

      <View style={styles.phoneMockup}>
        <View style={styles.phoneTopbar}>
          <View style={styles.phoneBrandMark} />
          <View style={styles.phoneTopLines}>
            <View style={styles.phoneLineLong} />
            <View style={styles.phoneLineShort} />
          </View>
          <View style={styles.phoneAvatar} />
        </View>

        <Text style={styles.phoneGreeting}>Good morning</Text>
        <Text style={styles.phoneSubheading}>Your water, within reach.</Text>

        <View style={styles.phoneProductCard}>
          <View style={styles.waterBottle}>
            <View style={styles.bottleCap} />
            <View style={styles.bottleBody} />
          </View>
          <View style={styles.phoneProductCopy}>
            <Text style={styles.phoneProductTitle}>Purified Water</Text>
            <Text style={styles.phoneProductMeta}>5 gallons · ₱30.00</Text>
            <View style={styles.phoneOrderButton}>
              <Text style={styles.phoneOrderButtonText}>Order now</Text>
            </View>
          </View>
        </View>

        <View style={styles.phoneOrderCard}>
          <View style={styles.phoneOrderHeader}>
            <Text style={styles.phoneOrderTitle}>Current request</Text>
            <View style={styles.phoneStatusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.phoneStatusText}>Accepted</Text>
            </View>
          </View>
          <View style={styles.deliveryProgress}>
            <View style={styles.deliveryProgressActive} />
          </View>
          <Text style={styles.deliveryText}>Your station is preparing your order.</Text>
        </View>
      </View>

      <View style={[styles.floatingStatus, styles.floatingStatusTop]}>
        <View style={[styles.floatingIcon, styles.floatingIconBlue]}>
          <Text style={styles.floatingIconText}>✓</Text>
        </View>
        <View>
          <Text style={styles.floatingStatusTitle}>Request accepted</Text>
          <Text style={styles.floatingStatusText}>Your station was notified</Text>
        </View>
      </View>

      <View style={[styles.floatingStatus, styles.floatingStatusBottom]}>
        <View style={[styles.floatingIcon, styles.floatingIconGreen]}>
          <Text style={styles.floatingIconText}>→</Text>
        </View>
        <View>
          <Text style={styles.floatingStatusTitle}>On the way</Text>
          <Text style={styles.floatingStatusText}>Delivery update received</Text>
        </View>
      </View>
    </View>
  );
}

function DistributorMockup() {
  return (
    <View style={styles.distributorMockup}>
      <View style={styles.distributorTopbar}>
        <View>
          <Text style={styles.distributorKicker}>BLUE TAP STATION</Text>
          <Text style={styles.distributorTitle}>Today’s requests</Text>
        </View>
        <View style={styles.distributorBadge}>
          <Text style={styles.distributorBadgeText}>8 new</Text>
        </View>
      </View>

      <View style={styles.distributorStatsRow}>
        <View style={styles.distributorStat}>
          <Text style={styles.distributorStatValue}>12</Text>
          <Text style={styles.distributorStatLabel}>Requests</Text>
        </View>
        <View style={styles.distributorStat}>
          <Text style={styles.distributorStatValue}>6</Text>
          <Text style={styles.distributorStatLabel}>Scheduled</Text>
        </View>
        <View style={styles.distributorStat}>
          <Text style={styles.distributorStatValue}>4</Text>
          <Text style={styles.distributorStatLabel}>Delivered</Text>
        </View>
      </View>

      <View style={styles.distributorRequest}>
        <View style={styles.distributorRequestIcon}>
          <Text style={styles.distributorRequestIconText}>BT</Text>
        </View>
        <View style={styles.distributorRequestCopy}>
          <Text style={styles.distributorRequestTitle}>6 gallons · New container</Text>
          <Text style={styles.distributorRequestMeta}>Requested for today</Text>
        </View>
        <View style={styles.distributorRequestPill}>
          <Text style={styles.distributorRequestPillText}>Pending</Text>
        </View>
      </View>

      <View style={styles.distributorRequest}>
        <View style={[styles.distributorRequestIcon, styles.distributorRequestIconPale]}>
          <Text style={[styles.distributorRequestIconText, styles.distributorRequestIconTextBlue]}>BT</Text>
        </View>
        <View style={styles.distributorRequestCopy}>
          <Text style={styles.distributorRequestTitle}>4 gallons · Refill</Text>
          <Text style={styles.distributorRequestMeta}>Scheduled tomorrow</Text>
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
  const themeProgress = useRef(new Animated.Value(0)).current;
  const [isDark, setIsDark] = useState(false);
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const isTablet = width >= TABLET_BREAKPOINT && !isDesktop;
  const isNarrow = width < 420;
  const contentPadding = isDesktop ? 42 : isTablet ? 30 : 20;
  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  useEffect(() => {
    Animated.timing(themeProgress, {
      toValue: isDark ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [isDark, themeProgress]);

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
    scrollRef.current?.scrollTo({ y: Math.max(offset - 12, 0), animated: true });
  }, []);

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
        <Animated.View style={[styles.navbar, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface), borderBottomColor: transitionColor('#E7EFF6', '#26445D') }]}>
          <View style={styles.navbarContent}>
            <TouchableOpacity
              accessibilityLabel="BlueTap home"
              activeOpacity={0.8}
              onPress={() => scrollToSection('home')}
            >
              <Brand small={!isDesktop} />
            </TouchableOpacity>

            {isDesktop && (
              <View style={styles.navLinks}>
                <TouchableOpacity onPress={() => scrollToSection('home')} style={styles.navLinkButton}>
                  <Text style={[styles.navLink, { color: theme.text }]}>Home</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => scrollToSection('how')} style={styles.navLinkButton}>
                  <Text style={[styles.navLink, { color: theme.text }]}>How It Works</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => scrollToSection('distributors')} style={styles.navLinkButton}>
                  <Text style={[styles.navLink, { color: theme.text }]}>For Distributors</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => scrollToSection('about')} style={styles.navLinkButton}>
                  <Text style={[styles.navLink, { color: theme.text }]}>About</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.navbarActions}>
              <TouchableOpacity
                accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                accessibilityRole="button"
                activeOpacity={0.8}
                onPress={() => setIsDark((currentTheme) => !currentTheme)}
                style={[styles.themeToggle, isDark && styles.themeToggleDark]}
              >
                <Text style={[styles.themeToggleText, isDark && styles.themeToggleTextDark]}>
                  {isDark ? '☀' : '☾'}
                </Text>
              </TouchableOpacity>
              {!isNarrow && (
                <TouchableOpacity
                accessibilityLabel="Log in"
                activeOpacity={0.8}
                onPress={() => router.push('/login')}
                style={styles.loginLinkButton}
              >
                  <Text style={[styles.loginLinkText, { color: theme.accent }]}>Log in</Text>
              </TouchableOpacity>
              )}
              <ActionButton
                label="Get Started"
                onPress={() => router.push('/login?signup=true')}
                isDark={isDark}
                style={[styles.navGetStarted, !isDesktop && styles.navGetStartedCompact]}
              />
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('home')} style={[styles.heroSection, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={[styles.heroContent, !isDesktop && styles.heroContentCompact]}>
            <View style={[styles.heroCopy, !isDesktop && styles.heroCopyCompact]}>
              <View style={styles.heroBadge}>
                <View style={styles.heroBadgeDot} />
                <Text style={styles.heroBadgeText}>Fast · Reliable · Local</Text>
              </View>

              <Text style={[styles.heroTitle, { color: theme.text }, !isDesktop && styles.heroTitleCompact]}>
                Clean Water,{"\n"}
                Delivered <Text style={[styles.heroTitleAccent, { color: theme.accent }]}>Within Reach.</Text>
              </Text>

              <Text style={[styles.heroDescription, { color: theme.muted }, !isDesktop && styles.heroDescriptionCompact]}>
                Order purified water from trusted local water stations and have it
                delivered straight to your home.
              </Text>

              <View style={[styles.heroActions, !isDesktop && styles.heroActionsCompact]}>
                <ActionButton
                  label="Order Water"
                  onPress={() => router.push('/login?signup=true')}
                  isDark={isDark}
                  style={!isDesktop && styles.heroActionCompact}
                />
                <ActionButton
                  label="Become a Distributor"
                  onPress={() => router.push('/login?signup=true')}
                  variant="outline"
                  isDark={isDark}
                  style={!isDesktop && styles.heroActionCompact}
                />
              </View>

              <Text style={[styles.heroTrust, { color: theme.muted }]}>
                Simple ordering · Local stations · Convenient delivery
              </Text>
            </View>

            <View style={[styles.heroVisual, !isDesktop && styles.heroVisualCompact]}>
              <PhoneMockup />
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('how')} style={[styles.section, styles.howSection, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={webContentStyle}>
            <SectionHeading
              eyebrow="HOW IT WORKS"
              title="Water ordering made simple"
              text="Get your water in just a few steps."
              theme={theme}
              align="center"
            />
            <View style={[styles.stepGrid, !isDesktop && styles.stepGridCompact]}>
              {steps.map((step) => (
                <View
                  key={step.number}
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
                </View>
              ))}
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('about')} style={[styles.section, styles.featureSection, { backgroundColor: transitionColor(LIGHT_THEME.softSurface, DARK_THEME.softSurface) }]}>
          <View style={webContentStyle}>
            <SectionHeading
              eyebrow="WHY BLUETAP"
              title="Why choose BlueTap?"
              text="A clearer, more convenient way for households and local water stations to connect."
              theme={theme}
              align="center"
            />
            <View style={[styles.featureGrid, !isDesktop && styles.featureGridCompact]}>
              {features.map((feature) => (
                <View
                  key={feature.title}
                  style={[styles.featureCard, !isDesktop && styles.featureCardCompact]}
                >
                  <View style={styles.featureIcon}>
                    <Text style={styles.featureIconText}>{feature.icon}</Text>
                  </View>
                  <View style={styles.featureCopy}>
                    <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                    <Text style={[styles.featureText, { color: theme.muted }]}>{feature.text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>

        <Animated.View onLayout={saveSectionOffset('distributors')} style={[styles.section, { backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
          <View style={[webContentStyle, styles.distributorSection, !isDesktop && styles.distributorSectionCompact]}>
            <View style={[styles.distributorVisual, !isDesktop && styles.distributorVisualCompact]}>
              <DistributorMockup />
            </View>
            <View style={[styles.distributorCopy, !isDesktop && styles.distributorCopyCompact]}>
              <SectionHeading
                eyebrow="FOR WATER DISTRIBUTORS"
                title="Grow your water station with BlueTap"
                text="Receive customer requests digitally and manage your water delivery workflow through one convenient platform."
                theme={theme}
              />
              <View style={styles.checkList}>
                {[
                  'Receive customer requests',
                  'Organize scheduled deliveries',
                  'Maintain request history',
                ].map((item) => (
                  <View key={item} style={styles.checkItem}>
                    <View style={styles.checkIcon}>
                      <Text style={styles.checkIconText}>✓</Text>
                    </View>
                    <Text style={[styles.checkText, { color: theme.text }]}>{item}</Text>
                  </View>
                ))}
              </View>
              <ActionButton
                label="Apply as Distributor"
                onPress={() => router.push('/login?signup=true')}
                isDark={isDark}
                style={styles.distributorAction}
              />
            </View>
          </View>
        </Animated.View>

        <Animated.View style={[styles.ctaSection, { paddingHorizontal: contentPadding, backgroundColor: transitionColor(LIGHT_THEME.surface, DARK_THEME.surface) }]}>
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
                Join BlueTap and connect with local water stations in a simpler way.
              </Text>
            </View>
            <View style={[styles.ctaActions, !isDesktop && styles.ctaActionsCompact]}>
              <ActionButton
                label="Get Started"
                onPress={() => router.push('/login?signup=true')}
                variant="light"
                style={!isDesktop && styles.ctaActionCompact}
              />
              <ActionButton
                label="Log In"
                onPress={() => router.push('/login')}
                variant="inverseOutline"
                style={!isDesktop && styles.ctaActionCompact}
              />
            </View>
          </LinearGradient>
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
            Order purified water from local stations in a few simple steps.
          </Text>

          <View style={styles.nativeActions}>
            <ActionButton
              label="Get Started"
              onPress={() => router.push('/login?signup=true')}
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
  brandLogo: { width: 38, height: 38, marginRight: 9 },
  brandLogoSmall: { width: 31, height: 31, marginRight: 7 },
  brandText: { color: BLUE, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  brandTextSmall: { fontSize: 20 },
  brandTextInverse: { color: '#FFFFFF' },
  navLinks: { flexDirection: 'row', alignItems: 'center', marginLeft: 40, marginRight: 22 },
  navLinkButton: { paddingHorizontal: 12, paddingVertical: 10 },
  navLink: { color: '#41566D', fontSize: 14, fontWeight: '700' },
  navbarActions: { flexDirection: 'row', alignItems: 'center' },
  loginLinkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  loginLinkText: { color: BLUE_DARK, fontSize: 14, fontWeight: '800' },
  actionButton: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
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
  themeToggle: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF8FF', borderWidth: 1, borderColor: '#CFE9F9', marginRight: 8 },
  themeToggleDark: { backgroundColor: '#193650', borderColor: '#427AA2' },
  themeToggleText: { color: BLUE_DARK, fontSize: 20, fontWeight: '800', lineHeight: 21 },
  themeToggleTextDark: { color: '#FFD67A' },
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
  heroBadgeDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#2BA6E8', marginRight: 7 },
  heroBadgeText: { color: BLUE_DARK, fontSize: 13, fontWeight: '800' },
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
  heroOrbLarge: { position: 'absolute', width: 388, height: 388, borderRadius: 194, backgroundColor: '#DDF3FF', right: 24, top: 28 },
  heroOrbSmall: { position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: '#9DDBFA', left: 12, bottom: 36 },
  phoneMockup: { width: 264, borderRadius: 27, backgroundColor: '#FFFFFF', padding: 16, zIndex: 2, shadowColor: '#075D9D', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.19, shadowRadius: 24, elevation: 10 },
  phoneTopbar: { flexDirection: 'row', alignItems: 'center', marginBottom: 17 },
  phoneBrandMark: { width: 28, height: 28, borderRadius: 14, backgroundColor: BLUE },
  phoneTopLines: { flex: 1, marginLeft: 9 },
  phoneLineLong: { width: 70, height: 6, borderRadius: 999, backgroundColor: '#D1E8F8' },
  phoneLineShort: { width: 44, height: 4, borderRadius: 999, backgroundColor: '#E5F2FA', marginTop: 5 },
  phoneAvatar: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#BDE5FA' },
  phoneGreeting: { color: '#6C8499', fontSize: 10, fontWeight: '700' },
  phoneSubheading: { color: TEXT_DARK, fontSize: 15, fontWeight: '800', marginTop: 3 },
  phoneProductCard: { flexDirection: 'row', backgroundColor: '#F0F9FF', borderRadius: 16, padding: 12, marginTop: 14 },
  waterBottle: { width: 52, height: 68, alignItems: 'center', justifyContent: 'center' },
  bottleCap: { width: 16, height: 9, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#6CC3EF', marginBottom: -1 },
  bottleBody: { width: 37, height: 49, borderRadius: 12, borderWidth: 4, borderColor: '#47A9DE', backgroundColor: '#CBEFFF' },
  phoneProductCopy: { flex: 1, marginLeft: 8 },
  phoneProductTitle: { color: TEXT_DARK, fontSize: 12, fontWeight: '800' },
  phoneProductMeta: { color: TEXT_MUTED, fontSize: 9, fontWeight: '700', marginTop: 4 },
  phoneOrderButton: { backgroundColor: BLUE, borderRadius: 8, marginTop: 8, paddingVertical: 6, alignItems: 'center' },
  phoneOrderButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  phoneOrderCard: { borderWidth: 1, borderColor: '#E0EEF7', borderRadius: 15, padding: 12, marginTop: 13 },
  phoneOrderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phoneOrderTitle: { color: TEXT_DARK, fontSize: 11, fontWeight: '800' },
  phoneStatusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E7F9EF', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  statusDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#22A45D', marginRight: 4 },
  phoneStatusText: { color: '#168448', fontSize: 8, fontWeight: '800' },
  deliveryProgress: { height: 5, borderRadius: 999, backgroundColor: '#E7F1F7', marginTop: 12, overflow: 'hidden' },
  deliveryProgressActive: { width: '62%', height: '100%', borderRadius: 999, backgroundColor: '#55B9E9' },
  deliveryText: { color: '#778EA1', fontSize: 8, lineHeight: 12, fontWeight: '600', marginTop: 8 },
  floatingStatus: { position: 'absolute', zIndex: 3, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 13, padding: 10, shadowColor: '#286A95', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 5 },
  floatingStatusTop: { top: 64, right: 0 },
  floatingStatusBottom: { bottom: 51, left: 0 },
  floatingIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  floatingIconBlue: { backgroundColor: '#E4F4FF' },
  floatingIconGreen: { backgroundColor: '#E6F8ED' },
  floatingIconText: { color: BLUE_DARK, fontSize: 15, fontWeight: '900' },
  floatingStatusTitle: { color: TEXT_DARK, fontSize: 10, fontWeight: '800' },
  floatingStatusText: { color: TEXT_MUTED, fontSize: 8, fontWeight: '600', marginTop: 3 },
  section: { width: '100%', paddingTop: 88, paddingBottom: 88 },
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
  featureIconText: { color: BLUE_DARK, fontSize: 22, fontWeight: '900' },
  featureCopy: { flex: 1, paddingRight: 16 },
  featureTitle: { color: TEXT_DARK, fontSize: 17, fontWeight: '800' },
  featureText: { color: TEXT_MUTED, fontSize: 14, lineHeight: 21, marginTop: 6 },
  distributorSection: { flexDirection: 'row', alignItems: 'center' },
  distributorSectionCompact: { flexDirection: 'column' },
  distributorVisual: { flex: 1, paddingRight: 64 },
  distributorVisualCompact: { width: '100%', paddingRight: 0, marginBottom: 42 },
  distributorCopy: { flex: 1, maxWidth: 510 },
  distributorCopyCompact: { width: '100%', maxWidth: 620 },
  distributorMockup: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: '#DCECF7', padding: 22, shadowColor: '#286A95', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 6 },
  distributorTopbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  distributorKicker: { color: BLUE, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  distributorTitle: { color: TEXT_DARK, fontSize: 20, fontWeight: '800', marginTop: 5 },
  distributorBadge: { backgroundColor: '#E8F8EE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  distributorBadgeText: { color: '#17894B', fontSize: 11, fontWeight: '800' },
  distributorStatsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F2FAFF', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 10, marginTop: 22 },
  distributorStat: { flex: 1, alignItems: 'center' },
  distributorStatValue: { color: BLUE_DARK, fontSize: 21, fontWeight: '900' },
  distributorStatLabel: { color: TEXT_MUTED, fontSize: 10, fontWeight: '700', marginTop: 4 },
  distributorRequest: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#E9F0F5' },
  distributorRequestIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE, marginRight: 11 },
  distributorRequestIconPale: { backgroundColor: '#DDF2FF' },
  distributorRequestIconText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  distributorRequestIconTextBlue: { color: BLUE_DARK },
  distributorRequestCopy: { flex: 1, minWidth: 0 },
  distributorRequestTitle: { color: TEXT_DARK, fontSize: 12, fontWeight: '800' },
  distributorRequestMeta: { color: TEXT_MUTED, fontSize: 10, fontWeight: '600', marginTop: 4 },
  distributorRequestPill: { backgroundColor: '#FFF5D9', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 8 },
  distributorRequestPillBlue: { backgroundColor: '#E4F4FF' },
  distributorRequestPillText: { color: '#B77900', fontSize: 9, fontWeight: '800' },
  distributorRequestPillTextBlue: { color: BLUE_DARK, fontSize: 9, fontWeight: '800' },
  checkList: { marginTop: 4, marginBottom: 25 },
  checkItem: { flexDirection: 'row', alignItems: 'center', marginTop: 13 },
  checkIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3F8ED', marginRight: 10 },
  checkIconText: { color: '#16884B', fontSize: 12, fontWeight: '900' },
  checkText: { color: '#425A70', fontSize: 15, fontWeight: '700' },
  distributorAction: { alignSelf: 'flex-start' },
  ctaSection: { width: '100%', backgroundColor: '#FFFFFF', paddingTop: 4, paddingBottom: 88 },
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
