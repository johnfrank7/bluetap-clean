const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('shared icon contract uses semantic foregrounds, supported tint props, non-zero frames, and fallbacks', () => {
  const icon = read('components', 'BlueTapIcon.jsx');
  const brand = read('components', 'BlueTapBrandMark.jsx');
  const theme = read('constants', 'bluetapTheme.js');

  for (const token of ['iconPrimary', 'iconSecondary', 'iconOnPrimary', 'iconMuted', 'iconDanger', 'iconWarning', 'iconSuccess', 'iconInteractive']) {
    assert.match(theme, new RegExp(token));
  }
  assert.match(icon, /export default function BlueTapIcon/);
  assert.match(icon, /tintColor=\{resolvedColor\}/);
  assert.match(icon, /onError=\{\(\) => setAssetFailed\(true\)\}/);
  assert.match(icon, /width: size, height: size/);
  assert.match(icon, /ICON_FALLBACKS/);
  assert.match(brand, /export default function BlueTapBrandMark/);
  assert.match(brand, /BLUE_MARK/);
  assert.match(brand, /WHITE_MARK/);
  assert.match(brand, /styles\.drop/);
});

test('all critical raster icon assets exist and are non-empty', () => {
  for (const asset of ['home.png', 'home1.png', 'user.png', 'ballot.png', 'calendar-clock.png', 'notif.png', 'bluetaplogo.png', 'bluetapwhitelogo.png']) {
    const stat = fs.statSync(path.join(root, 'assets', 'icons', asset));
    assert.ok(stat.isFile(), `${asset} must be a file`);
    assert.ok(stat.size > 0, `${asset} must not be empty`);
  }
});

test('Requester and Distributor navigation icons have explicit themed colors and active cues', () => {
  const nav = read('components', 'AppBottomNav.jsx');
  assert.match(nav, /<ExpoImage/);
  assert.match(nav, /tintColor=\{color\}/);
  assert.match(nav, /colors\.navIconMuted/);
  assert.match(nav, /colors\.iconPrimary/);
  assert.match(nav, /const requesterItems/);
  assert.match(nav, /const distributorItems/);
  assert.match(nav, /isActive && \{/);
  assert.match(nav, /borderColor: colors\.navSelectedBorder/);
  assert.match(nav, /backgroundColor: colors\.primarySoft/);
});

test('portal and Manager bells retain glyphs independently from their badges', () => {
  const header = read('components', 'BlueTapHeader.jsx');
  const manager = read('components', 'ManagerShell.jsx');
  for (const source of [header, manager]) {
    assert.match(source, /BlueTapIcon name="notifications"/);
    assert.match(source, /iconOnPrimary|iconInteractive/);
  }
  assert.match(header, /notificationBadge/);
  assert.match(manager, /notificationCount/);
});

test('Assistant, notifications, chat, Login, and empty states use durable visual contracts', () => {
  const assistant = read('components', 'assistant', 'AssistantScreen.jsx');
  const quickActions = read('components', 'assistant', 'AssistantQuickActions.jsx');
  const notification = read('components', 'NotificationCard.jsx');
  const empty = read('components', 'BlueTapEmptyState.jsx');
  const chat = read('components', 'chat', 'BlueTapChatIcon.jsx');
  const login = read('app', 'login.jsx');

  assert.match(assistant, /BlueTapBrandMark/);
  assert.match(assistant, /BlueTapIcon name="close"/);
  assert.match(assistant, /BlueTapIcon name="reset"/);
  assert.match(quickActions, /quickActionIcon/);
  assert.match(quickActions, /colors\.iconInteractive/);
  assert.match(notification, /BlueTapIcon name=\{tone\.kind\}/);
  assert.match(empty, /BlueTapIcon name=\{variant\}/);
  assert.match(chat, /useBlueTapTheme/);
  assert.match(chat, /resolvedColor/);
  assert.match(login, /BlueTapBrandMark/);
  assert.match(login, /backgroundColor: pressed \? '#D7ECFF' : hovered \? '#EAF6FF' : '#FFFFFF'/);
});

test('privileged sidebars share Lucide assets with explicit dimensions and foreground', () => {
  const icon = read('components', 'SidebarIcon.jsx');
  const manager = read('components', 'ManagerShell.jsx');
  const admin = read('components', 'AdminShell.jsx');
  assert.match(manager, /MANAGER_SIDEBAR_ICONS\[item.key\]/);
  assert.match(admin, /ADMIN_SIDEBAR_ICONS\[icon\]/);
  assert.match(icon, /width: size, height: size/);
  assert.match(icon, /flexShrink: 0/);
  assert.match(icon, /tintColor=\{color\}/);
  assert.doesNotMatch(icon, /<Text|\\u[0-9A-Fa-f]{4}/);
  const assets = [...icon.matchAll(/require\('\.\.\/assets\/icons\/sidebar\/([^']+\.svg)'\)/g)];
  assert.equal(assets.length, 19);
  assert.match(icon, /CircleDollarSign: require\('\.\.\/assets\/icons\/sidebar\/circle-dollar-sign\.svg'\)/);
  for (const [, filename] of assets) {
    const svg = read('assets', 'icons', 'sidebar', filename);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke="#FFFFFF"/);
    assert.match(svg, /stroke-width="2"/);
    assert.doesNotMatch(svg, /<script|<image|href=/);
  }
});

test('chat launcher motion is subtle and fully reduced-motion aware', () => {
  const launcher = read('components', 'chat', 'ChatFloatingLauncher.jsx');
  assert.match(launcher, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(launcher, /toValue: -2/);
  assert.match(launcher, /duration: 1400/);
  assert.match(launcher, /reduceMotion \|\| interacting \|\| panelOpen/);
  assert.match(launcher, /animation\.stop\(\)/);
});

test('dashboard clock updates once per minute and remains beside the greeting at narrow widths', () => {
  const clock = read('components', 'LocalTimeCard.jsx');
  const requester = read('app', 'requester', 'r_dashboard.jsx');
  const distributor = read('app', 'distributor', 'd_dashboard.jsx');
  assert.match(clock, /60000 - \(Date\.now\(\) % 60000\)/);
  assert.match(clock, /setInterval\(update, 60000\)/);
  assert.match(clock, /clearInterval/);
  assert.match(clock, /accessibilityLabel=\{`Local time/);
  assert.match(clock, /BlueTapIcon name=\{daytime \? 'sun' : 'moon'\}/);
  assert.match(requester, /compact=\{windowWidth < 430\}/);
  assert.match(distributor, /compact=\{width < 430\}/);
  assert.doesNotMatch(requester, /welcomeRowStacked|stacked=/);
  assert.doesNotMatch(distributor, /welcomeRowStacked|stacked=/);
  assert.match(requester, /<LocalTimeCard/);
  assert.match(distributor, /<LocalTimeCard/);
});

test('global motion CSS never overrides child icon visibility', () => {
  const css = read('global.css');
  assert.doesNotMatch(css, /button\s+svg|\[role=['"]button['"]\]\s+svg|img\s*\{[^}]*opacity\s*:\s*0|svg\s*\{[^}]*opacity\s*:\s*0/);
});

test('Requester and Distributor profile pages define, bind, and render valid vector logout icons without ReferenceError', () => {
  const requesterProfile = read('app', 'requester', 'r_profile.jsx');
  const distributorProfile = read('app', 'distributor', 'd_profile.jsx');

  const profileConfigs = [
    { name: 'Requester profile', source: requesterProfile },
    { name: 'Distributor profile', source: distributorProfile },
  ];

  for (const { name, source } of profileConfigs) {
    // 1. Verify LOGOUT_ICON is declared/assigned to the valid SVG asset
    assert.match(
      source,
      /const\s+LOGOUT_ICON\s*=\s*require\(['"]\.\.\/\.\.\/assets\/icons\/sidebar\/log-out\.svg['"]\);/,
      `${name} must declare LOGOUT_ICON requiring log-out.svg`
    );

    // 2. Verify ExpoImage is imported from expo-image
    assert.match(
      source,
      /import\s+\{\s*Image\s+as\s+ExpoImage\s*\}\s+from\s+['"]expo-image['"]/,
      `${name} must import ExpoImage from expo-image`
    );

    // 3. Verify ExpoImage source references LOGOUT_ICON and uses semantic onPrimary tint
    assert.match(
      source,
      /<ExpoImage[^>]*source=\{LOGOUT_ICON\}[^>]*tintColor=\{colors\.onPrimary/,
      `${name} must render ExpoImage with LOGOUT_ICON and themed onPrimary tint`
    );

    // 4. AST Scope Analysis: Verify LOGOUT_ICON has a valid binding in module scope (prevent ReferenceError)
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx'],
    });

    let referencedCount = 0;
    traverse(ast, {
      Identifier(astPath) {
        if (astPath.node.name === 'LOGOUT_ICON' && astPath.isReferencedIdentifier()) {
          referencedCount++;
          assert.ok(
            astPath.scope.hasBinding('LOGOUT_ICON'),
            `${name} has an un-scoped or unbound LOGOUT_ICON reference which causes ReferenceError`
          );
        }
      },
    });
    assert.ok(referencedCount > 0, `${name} must reference LOGOUT_ICON in its render tree`);

    // 5. Verify logout action preserves confirmLeave and handleLogout calling signOutAndClearSessions
    assert.match(
      source,
      /onPress=\{\(\)\s*=>\s*confirmLeave\(handleLogout\)\}/,
      `${name} must trigger confirmLeave(handleLogout)`
    );
    assert.match(
      source,
      /await\s+signOutAndClearSessions\(\)/,
      `${name} handleLogout must call signOutAndClearSessions`
    );
    assert.match(
      source,
      /router\.replace\(['"]\/login['"]\)/,
      `${name} handleLogout must navigate to /login`
    );
  }

  // 6. Verify the referenced asset actually exists on disk and is a valid SVG
  const logoutSvgPath = path.join(root, 'assets', 'icons', 'sidebar', 'log-out.svg');
  assert.ok(fs.existsSync(logoutSvgPath), 'log-out.svg asset must exist on disk');
  const stat = fs.statSync(logoutSvgPath);
  assert.ok(stat.size > 0, 'log-out.svg asset must not be empty');
  const svgContent = fs.readFileSync(logoutSvgPath, 'utf8');
  assert.match(svgContent, /<svg[^>]*viewBox="0 0 24 24"/);
});


const ALLOWED_GLOBALS = new Set([
  'require', 'console', 'Promise', 'Date', 'Math', 'Number', 'String', 'Boolean', 'Object', 'Array',
  'JSON', 'Error', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'undefined', 'isNaN',
  'parseInt', 'parseFloat', 'Set', 'Map', 'RegExp', 'Intl', 'globalThis', 'window', 'document',
]);

function unboundReferences(source) {
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const unbound = new Set();
  traverse(ast, {
    ReferencedIdentifier(astPath) {
      const { name } = astPath.node;
      if (astPath.isJSXIdentifier() && /^[a-z]/.test(name)) return; // intrinsic JSX tags
      if (!astPath.scope.hasBinding(name) && !ALLOWED_GLOBALS.has(name)) unbound.add(name);
    },
  });
  return [...unbound];
}

test('Distributor Profile keeps its latest BlueTap design, fields, Assistant entry, guarded logout, and no unbound identifiers', () => {
  const source = read('app', 'distributor', 'd_profile.jsx');

  // Renders without undefined variables (static AST scope analysis; not a runtime render).
  // Known pre-existing exception (HEAD 3655f06): the dead, never-invoked `showSuccessToast`
  // helper references `setToastVisible`. It stays safe only while nothing calls it, which
  // the `showSuccessToast\(\)` assertion below enforces.
  assert.deepEqual(
    unboundReferences(source).filter((name) => name !== 'setToastVisible'),
    [],
    'Distributor Profile must not reference unbound identifiers'
  );

  // Latest portal canvas and theme-token styling (guards against the stale-buffer rollback).
  assert.match(source, /import DistributorPortalBackground from '\.\.\/\.\.\/components\/DistributorPortalBackground';/);
  assert.match(source, /return \(\s*<DistributorPortalBackground>/);
  assert.match(source, /<\/SafeAreaView>\s*<\/DistributorPortalBackground>/);
  assert.match(source, /container: \{\s*flex: 1,\s*backgroundColor: 'transparent',/);
  assert.match(source, /profileTitle: \{[^}]*color: BLUETAP_COLORS\.white/);
  assert.match(source, /const \{ colors \} = useBlueTapTheme\(\);/);
  assert.match(source, /identityCard:/);
  assert.match(source, /<View style=\{styles\.identityCard\}>/);
  assert.match(source, /backgroundColor: BLUETAP_COLORS\.dangerSoft/);
  assert.doesNotMatch(source, /#FFF5F5|#F2B8B5|#B3261E|#BBDEFB|#F7FBFF/, 'stale hardcoded colors must not return');
  assert.doesNotMatch(source, /coming soon/i, 'stale Assistant placeholder must not return');
  assert.doesNotMatch(source, /toastVisible|showSuccessToast\(\)/, 'stale duplicate success toast must not return');

  // Existing profile fields and data bindings.
  for (const [label, binding] of [
    ['Public ID', 'profileDisplay.distributorId'],
    ['Full Name', 'profileDisplay.fullName'],
    ['Contact Number', 'profileDisplay.contactNumber'],
    ['Email Address', 'profileDisplay.email'],
    ['Complete Address', 'profileDisplay.address'],
    ['Water Station', 'profileDisplay.waterStation'],
    ['Account Role', 'profileDisplay.role'],
  ]) {
    assert.match(source, new RegExp(`label="${label}"`), `${label} field must remain`);
    assert.ok(source.includes(binding), `${binding} binding must remain`);
  }
  assert.match(source, /waterStation: resolvedBranchName \|\| getWaterStation\(userData\) \|\| 'Not Assigned'/);
  assert.equal((source.match(/distributorId: getDistributorId\(userData\)/g) || []).length, 1, 'distributorId must be bound once');

  // BlueTap Assistant entry point.
  assert.match(source, /const \{ replaceOnce \} = useSingleFlightNavigation\(\);/);
  assert.match(source, /onPress=\{\(\) => replaceOnce\('\/distributor\/bluetap_AI'\)\}/);
  assert.match(source, /accessibilityLabel="Open BlueTap Assistant"/);
  assert.match(source, /<BlueTapBrandMark color=\{colors\.iconInteractive \|\| BLUE\}/);

  // Unsaved-changes guard and logout flow.
  assert.match(source, /const \{ confirmLeave, UnsavedModal \} = useUnsavedChangesGuard\(/);
  assert.match(source, /onPress=\{\(\) => confirmLeave\(cancelProfileEdit\)\}/);
  assert.match(source, /onPress=\{\(\) => confirmLeave\(handleLogout\)\}/);
  assert.match(source, /<UnsavedModal \/>/);
  assert.match(source, /<ExpoImage[^>]*source=\{LOGOUT_ICON\}/);
  assert.doesNotMatch(source, /\{'\\u21AA'\}/, 'Unicode logout glyph must not return');
});

test('Requester Profile keeps its gradient layout, Assistant entry, and guarded logout', () => {
  const source = read('app', 'requester', 'r_profile.jsx');
  assert.deepEqual(unboundReferences(source), [], 'Requester Profile must not reference unbound identifiers');
  assert.match(source, /<LinearGradient/);
  assert.match(source, /onPress=\{\(\) => replaceOnce\('\/requester\/bluetap_AI'\)\}/);
  assert.match(source, /onPress=\{\(\) => confirmLeave\(handleLogout\)\}/);
  assert.match(source, /<UnsavedModal \/>/);
  for (const label of ['Public ID', 'Full Name', 'Contact Number', 'Email Address', 'Complete Address']) {
    assert.match(source, new RegExp(`label="${label}"`));
  }
});
