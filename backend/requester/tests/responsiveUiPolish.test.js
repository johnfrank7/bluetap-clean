const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');
const { compactNotificationStatus, notificationLayoutForWidth } = require('../../../components/notificationPresentation');

test('theme transition uses semantic gold sun and cool BlueTap moon colors', () => {
  const source = read('components', 'BlueTapThemeTransition.jsx');
  assert.match(source, /darkTarget \? '#70BDF2' : '#FFD67A'/);
  assert.match(source, /const TRANSITION_DURATION = 640/);
});

test('native Login CTA has explicit semantic contrast, touch height, and press feedback', () => {
  const source = read('app', 'login.jsx');
  assert.match(source, /backgroundColor: pressed \? '#D7ECFF' : hovered \? '#EAF6FF' : '#FFFFFF'/);
  assert.match(source, /colors\.primaryDark \|\| colors\.primary/);
  assert.match(source, /minHeight: 48/);
  assert.match(source, /loginButtonHovered/);
  assert.match(source, /loginButtonPressed/);
  assert.match(source, /disabled=\{loading\}/);
});

test('Requester Orders uses the canonical blue light-theme canvas with readable pinned header text', () => {
  const source = read('app', 'requester', 'r_request.jsx');
  assert.match(source, /isDark \? \[colors\.background, colors\.header\] : \[colors\.primary, colors\.primaryLight\]/);
  assert.match(source, /fixedHeaderArea, \{ backgroundColor: isDark \? colors\.background : colors\.primary \}/);
  assert.match(source, /pageTitle, \{ color: isDark \? colors\.textPrimary : colors\.onPrimary \}/);
  assert.match(source, /subtitle, \{ color: isDark \? colors\.textSecondary : colors\.onPrimary \}/);
});

test('portal page motion is subtle, directional, and reduced-motion aware', () => {
  const source = read('components', 'PortalSwipeContainer.jsx');
  const transition = read('components', 'PageEnterTransition.jsx');
  assert.match(source, /PageEnterTransition/);
  assert.match(transition, /useReducedMotionPreference/);
  assert.match(transition, /duration: reduceMotion \? 0 : duration/);
  assert.match(transition, /outputRange: \[Math\.sign\(direction \|\| 1\) \* distance, 0\]/);
  assert.match(transition, /opacity: progress/);
  assert.match(read('app', 'login.jsx'), /PageEnterTransition/);
  assert.match(read('components', 'assistant', 'AssistantScreen.jsx'), /PageEnterTransition/);
});

test('shared product cards reserve equal geometry and anchor their action', () => {
  const source = read('components', 'ProductCard.jsx');
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');
  assert.match(source, /maxWidth:320,minHeight:356/);
  assert.match(source, /compactCard:\{maxWidth:304,minHeight:344\}/);
  assert.match(source, /compactSelectionCard:\{minHeight:312,height:312\}/);
  assert.match(source, /borderRadius:USER_PORTAL_LAYOUT\.cardRadius/);
  assert.match(source, /name:\{minHeight:38/);
  assert.match(source, /marginTop:'auto'/);
  assert.match(dashboard, /PRODUCT_CARD_WIDTH_RATIO = 0\.88/);
  assert.match(dashboard, /PRODUCT_CAROUSEL_HEIGHT = 368/);
});

test('notification status labels are compact and responsive cards stack safely', () => {
  assert.equal(compactNotificationStatus('outside radius pending approval'), 'Pending');
  assert.equal(compactNotificationStatus('delivery_failed_rescheduling'), 'Failed');
  assert.equal(compactNotificationStatus('declined outside service area'), 'Declined');
  assert.deepEqual(notificationLayoutForWidth(377), { narrow: true, cardPadding: 12, metadataLines: 2 });
  assert.deepEqual(notificationLayoutForWidth(430), { narrow: false, cardPadding: 16, metadataLines: undefined });
  const card = read('components', 'NotificationCard.jsx');
  assert.match(card, /notificationLayoutForWidth\(width\)/);
  assert.match(card, /compactNotificationStatus\(status\)/);
  assert.match(card, /cardHeaderRowNarrow/);
});

test('all role notification pages use the shared right-side Back control', () => {
  const requester = read('app', 'requester', 'r_notification.jsx');
  const distributor = read('app', 'distributor', 'd_notification.jsx');
  const manager = read('app', 'manager', 'notifications.jsx');
  for (const source of [requester, distributor, manager]) {
    assert.match(source, /NotificationBackButton/);
    assert.match(source, /pageMotion\.goBack/);
    assert.match(source, /AnimatedPresenceItem/);
  }
  assert.match(read('components', 'ManagerShell.jsx'), /\{headerAction\}/);
});

test('Assistant and chat details use the shared current-page modal controller', () => {
  const assistant = read('components', 'assistant', 'AssistantScreen.jsx');
  const conversation = read('components', 'chat', 'ChatConversationView.jsx');
  const contextCard = read('components', 'chat', 'ChatOrderContextCard.jsx');
  for (const source of [assistant, conversation]) {
    assert.match(source, /useCurrentPageRequestDetails/);
    assert.match(source, /RequestDetailsModal/);
  }
  assert.match(assistant, /openRequestDetails\(action\.orderId\)/);
  assert.match(contextCard, /onViewDetails\(order\)/);
  assert.doesNotMatch(contextCard, /router\.push|orderDetailTarget/);
});

test('BlueTap chat icon and panel header remain theme-aware for every role', () => {
  const panel = read('components', 'chat', 'ChatPanel.jsx');
  const icon = read('components', 'chat', 'BlueTapChatIcon.jsx');
  const provider = read('components', 'chat', 'ChatDataProvider.jsx');
  assert.match(icon, /bubbleColor/);
  assert.match(icon, /detailColor/);
  assert.match(panel, /const brandHeader = !isDark && role !== 'manager'/);
  assert.match(panel, /colors\.onPrimary \|\| '#FFFFFF'/);
  assert.match(provider, /managerTheme\.resolvedTheme === 'dark'/);
});

test('distributor dashboard keeps a manual one-card snap carousel and equal action grid', () => {
  const source = read('app', 'distributor', 'd_dashboard.jsx');
  assert.match(source, /Delivery overview/i);
  assert.match(source, /snapToInterval=\{currentRequestSnap\}/);
  assert.match(source, /disableIntervalMomentum/);
  assert.match(source, /moveCarousel\(-1\)/);
  assert.match(source, /moveCarousel\(1\)/);
  assert.match(source, /active=\{index === activeRequestIndex\}/);
  assert.match(source, /pointerEvents=\{active \? 'auto' : 'none'\}/);
  assert.match(source, /resolveDragTargetIndex/);
  assert.match(source, /onMomentumScrollEnd=\{handleCarouselMomentumEnd\}/);
  assert.match(source, /onScrollEndDrag=\{handleCarouselDragEnd\}/);
  assert.match(source, /onTouchEnd=\{handleCarouselTouchEnd\}/);
  assert.match(source, /getCarouselIndexFromOffset/);
  assert.match(source, /setActiveRequestIndex\(nextIndex\)/);
  assert.match(source, /currentRequestPeek/);
  assert.match(source, /requestCountBadge/);
  assert.match(source, /carouselPosition/);
  assert.match(source, /minHeight: 352/);
  assert.doesNotMatch(source, /minHeight: 430/);
  assert.match(source, /cardActionsGrid/);
  assert.match(source, /flexBasis: '48%'/);
  assert.match(source, /summaryMetricHeader/);
  assert.match(source, /backgroundColor: colors\.surface, borderColor: item\.accent/);
  assert.doesNotMatch(source, /autoplay|autoPlay|setInterval/);
});

test('floating portal navigation stays compact without shrinking touch targets', () => {
  const nav = read('components', 'AppBottomNav.jsx');
  const assistant = read('components', 'assistant', 'AssistantScreen.jsx');
  assert.match(nav, /paddingVertical: 8/);
  assert.match(nav, /navButton:[\s\S]{0,100}width: 44,[\s\S]{0,60}height: 44/);
  assert.match(nav, /marginTop: -16/);
  assert.match(nav, /minHeight: USER_PORTAL_LAYOUT\.navHeight/);
  assert.match(assistant, /USER_PORTAL_LAYOUT\.navHeight \+/);
  assert.match(assistant, /USER_PORTAL_LAYOUT\.navBottomOffset \+/);
});

test('ProductCard reflects Phase 13A typography, description rendering, and high-contrast dark theme surfaces', () => {
  const source = read('components', 'ProductCard.jsx');
  assert.match(source, /product\?\.description/);
  assert.match(source, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{\[styles\.description/);
  assert.match(source, /fontSize:18,lineHeight:22,fontWeight:'800'/);
  assert.match(source, /description:\{fontSize:13,lineHeight:17,marginTop:3\}/);
  assert.match(source, /detail:\{minHeight:17,fontSize:13,lineHeight:17/);
  assert.match(source, /price:\{fontSize:22,lineHeight:26,fontWeight:'900'/);
  assert.match(source, /policyNote:\{fontSize:12,lineHeight:16/);
  assert.match(source, /cardBg = isDark \? colors\.surfaceAlt : colors\.surface/);
  assert.match(source, /isDark \? '#234E72' : colors\.border/);
  assert.match(source, /imageBg = isDark \? colors\.surface : colors\.surfaceAlt/);
  assert.match(source, /isDark \? '#CBD5E1' : colors\.textSecondary/);
  assert.match(source, /isDark \? \(colors\.primaryLight \|\| '#70BDF2'\) : colors\.primary/);
  assert.match(source, /compactImageSurface:\{height:112,width:'100%',padding:6\}/);
  assert.match(source, /compactSelectionImageSurface:\{height:92,width:'100%',padding:6\}/);
  assert.match(source, /height:356/);
});

test('Requester dashboard implements Phase 13B.3 smooth continuous looping typewriter animation with fast backspacing, natural blinking cursor, and reduced motion', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');
  assert.match(dashboard, /'Need water\? Order now!'/);
  assert.match(dashboard, /'Fresh water, one tap away!'/);
  assert.match(dashboard, /textRef\.current/);
  assert.match(dashboard, /GREETING_TYPING_SPEED = 65/);
  assert.match(dashboard, /GREETING_BACKSPACING_SPEED = 25/);
  assert.match(dashboard, /GREETING_DEFAULT_HOLD = 5000/);
  assert.match(dashboard, /GREETING_PROMO_HOLD = 3000/);
  assert.match(dashboard, /GREETING_ERASE_PAUSE = 250/);
  assert.match(dashboard, /phraseIndex = \(phraseIndex \+ 1\) % 3/);
  assert.match(dashboard, /useReducedMotionPreference/);
  assert.match(dashboard, /if \(reduceMotion\) \{/);
  assert.match(dashboard, /numberOfLines=\{1\}/);
  assert.match(dashboard, /ellipsizeMode="tail"/);
  assert.match(dashboard, /accessibilityElementsHidden/);
  assert.match(dashboard, /importantForAccessibility="no"/);
  assert.match(dashboard, /greetingWrapper:[\s\S]{0,60}minHeight:\s*22/);
  assert.match(dashboard, /text=\{`\$\{liveGreeting\}, \$\{requesterName\}!`\}/);
});

test('Requester My Orders implements Phase 13C empty states and conditional Add Request button', () => {
  const source = read('app', 'requester', 'r_request.jsx');
  const emptyState = read('components', 'BlueTapEmptyState.jsx');

  // 1. Active orders empty state
  assert.match(source, /title="Your next refill starts here!"/);
  assert.match(source, /description="No active orders yet\. Order your water in just a few taps\."/);
  assert.match(source, /actionLabel="Order Water Now"/);
  assert.match(source, /onAction=\{\(\) => router\.replace\('\/requester\/requestform'\)\}/);
  assert.match(source, /style=\{styles\.ordersEmptyCard\}/);

  // 2. History empty state
  assert.match(source, /variant="history"/);
  assert.match(source, /title="Your water journey begins here!"/);
  assert.match(source, /description="Your completed and past water orders will appear here\."/);

  // 3. Top Add Request button hidden when active orders empty
  assert.match(source, /isActiveOrdersTab && activeRequests\.length > 0/);

  // 4. Card geometry, styling, and BlueTapEmptyState modern enhancements
  assert.match(source, /ordersEmptyCard:[\s\S]{0,300}borderRadius:\s*USER_PORTAL_LAYOUT\.cardRadius/);
  assert.match(source, /ordersEmptyCard:[\s\S]{0,300}borderColor:\s*CARD_BORDER/);
  assert.match(emptyState, /borderBottomWidth:\s*2/);
  assert.match(emptyState, /actionStyle/);
  assert.match(emptyState, /actionTextStyle/);
  assert.match(emptyState, /dropletGlow/);
});

test('Phase 13D and 13B.3 empty state spacing, high-contrast CTA buttons, and typewriter blinking cursor', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');
  const emptyState = read('components', 'BlueTapEmptyState.jsx');
  const orders = read('app', 'requester', 'r_request.jsx');

  // 1. Blinking cursor implementation
  assert.match(dashboard, /GREETING_CURSOR_BLINK_INTERVAL = 500/);
  assert.match(dashboard, /const \[cursorVisible, setCursorVisible\] = useState\(true\)/);
  assert.match(dashboard, /setInterval\(\(\) => \{\s*setCursorVisible\(\(prev\) => !prev\);\s*\}, GREETING_CURSOR_BLINK_INTERVAL\)/);
  assert.match(dashboard, /startBlinking\(\)/);
  assert.match(dashboard, /stopBlinking\(\)/);
  assert.match(dashboard, /greetingCursor:[\s\S]{0,80}fontWeight:\s*'300'/);
  assert.match(dashboard, /greetingCursorHidden:[\s\S]{0,40}opacity:\s*0/);
  assert.match(dashboard, /!reduceMotion && \([\s\S]{0,100}greetingCursor/);

  // 2. High-contrast CTA buttons with Pressable
  assert.match(emptyState, /import \{[^}]*Pressable[^}]*\} from 'react-native'/);
  assert.match(emptyState, /<Pressable[\s\S]{0,250}styles\.actionButton/);
  assert.match(emptyState, /actionButton:[\s\S]{0,120}backgroundColor:\s*'#187BCD'/);
  assert.match(emptyState, /actionButtonDark:[\s\S]{0,80}backgroundColor:\s*'#1D78C1'/);
  assert.match(emptyState, /actionButtonText:[\s\S]{0,80}color:\s*'#FFFFFF'/);
  assert.match(emptyState, /minHeight:\s*44/);

  // 3. Empty-state illustration spacing & proportions
  assert.match(emptyState, /dropletGlowCompact:[\s\S]{0,60}width:\s*70/);
  assert.match(emptyState, /dropletCompact:[\s\S]{0,60}width:\s*48/);
  assert.match(orders, /ordersEmptyCard:[\s\S]{0,150}paddingVertical:\s*28/);
});
