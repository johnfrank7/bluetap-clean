const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..', '..', '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('Admin shell owns responsive navigation, theme preference, and confirmed logout', () => {
  const shell = read('components', 'AdminShell.jsx');
  const theme = read('components', 'AdminTheme.jsx');
  const icons = read('components', 'AdminIcon.jsx');
  const sessions = read('services', 'authSession.js');

  assert.match(shell, /accessibilityLabel="Toggle navigation"/);
  assert.match(shell, /'Security Settings', '\/admin\/registration-security'/);
  assert.doesNotMatch(shell, /'Session Security', '\/admin\//);
  assert.match(shell, /COLLAPSED_WIDTH = 76/);
  assert.match(shell, /DRAWER_WIDTH = 286/);
  assert.match(shell, /duration: 240/);
  assert.match(shell, /drawerOpen/);
  assert.match(shell, /Close navigation/);
  assert.match(shell, /accessibilityRole="switch"/);
  assert.match(shell, /Light mode/);
  assert.match(shell, /Dark mode/);
  assert.doesNotMatch(shell, /accessibilityRole="radio"/);
  assert.match(shell, /event\.key !== 'Escape'/);
  assert.match(shell, /Log out of BlueTap\?/);
  assert.match(shell, /signOutAndClearSessions\(\)/);
  assert.match(shell, /router\.replace\('\/admin\/login'\)/);
  assert.doesNotMatch(shell, /\['D', 'Dashboard'/);
  for (const name of ['dashboard', 'branches', 'accounts', 'distributors', 'security', 'theme', 'logout']) assert.match(icons, new RegExp(`${name}:`));

  assert.match(theme, /ADMIN_THEME_STORAGE_KEY = 'bluetap-admin-theme'/);
  assert.match(theme, /ADMIN_SIDEBAR_STORAGE_KEY = 'bluetap-admin-sidebar-collapsed'/);
  assert.match(theme, /useColorScheme/);
  assert.match(theme, /\['light', 'dark', 'system'\]/);
  assert.match(theme, /background: '#07131F'/);
  assert.match(theme, /surface: '#0E2235'/);
  assert.match(theme, /sidebar: '#0A1928'/);
  assert.match(theme, /primary: '#2186D9'/);
  assert.match(sessions, /clearAllAuthSessions\(\);[\s\S]*await signOut\(auth\)/);
});

test('every active Admin workspace route inherits the shared shell and themed dashboard primitives', () => {
  for (const page of ['dashboard.jsx', 'branches.jsx', 'managers.jsx', 'distributors.jsx', 'registration-security.jsx']) {
    const source = read('app', 'admin', page);
    assert.match(source, /AdminShell/);
    assert.match(source, /useAdminTheme/);
    assert.match(source, /createStyles/);
  }
  assert.match(read('app', 'admin', '_layout.jsx'), /AdminThemeProvider/);
  assert.match(read('app', 'manager', '_layout.jsx'), /AdminThemeProvider/);
  assert.match(read('components', 'ManagerShell.jsx'), /useAdminTheme/);
  for (const page of ['dashboard.jsx', 'analytics.jsx', 'products.jsx', 'request.jsx', 'distributors.jsx', 'profile.jsx']) {
    assert.match(read('app', 'manager', page), /useAdminTheme/);
  }
  const dashboardUi = read('components', 'DashboardUi.jsx');
  assert.match(dashboardUi, /useAdminTheme/);
  assert.match(dashboardUi, /colors\.surface/);
  assert.match(dashboardUi, /colors\.border/);
  assert.match(dashboardUi, /colors\.inputBorder/);
});
