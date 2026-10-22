const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('Responsive Layout: Viewport breakpoint calculations at 1440px, 1280px, 1024px, 900px, 768px, 480px, 375px', () => {
  const fileContent = read('app/manager/request.jsx');

  // Verify reliable responsive width >= 1100 threshold and memoized styles
  assert.match(fileContent, /const\s+isTwoColumn\s*=\s*width\s*>=\s*1100/);
  assert.match(fileContent, /styles\s*=\s*useMemo\(\s*\(\)\s*=>\s*createStyles\(colors,\s*width,\s*isDark,\s*isTwoColumn\)/);

  // Helper simulating the exact request page logic
  const checkViewport = (windowWidth) => {
    const isTwoColumn = windowWidth >= 1100;
    return { isTwoColumn };
  };

  // 1440px Desktop: wide viewport -> 2 columns
  assert.equal(checkViewport(1440).isTwoColumn, true, '1440px must use two columns');

  // 1280px Desktop: standard desktop -> 2 columns
  assert.equal(checkViewport(1280).isTwoColumn, true, '1280px must use two columns');

  // 1024px Desktop: content width < 840px -> stacks vertically to prevent clipping & text compression
  assert.equal(checkViewport(1024).isTwoColumn, false, '1024px must stack vertically');

  // 900px Desktop boundary: stacks vertically
  assert.equal(checkViewport(900).isTwoColumn, false, '900px must stack vertically');

  // 768px Tablet: stacks vertically
  assert.equal(checkViewport(768).isTwoColumn, false, '768px must stack vertically');

  // 480px Mobile landscape: stacks vertically
  assert.equal(checkViewport(480).isTwoColumn, false, '480px must stack vertically');

  // 375px Mobile portrait: stacks vertically
  assert.equal(checkViewport(375).isTwoColumn, false, '375px must stack vertically');
});

test('Flex Style Conflict Resolution: No mixed shorthand/longhand properties on cards and actions', () => {
  const fileContent = read('app/manager/request.jsx');
  const chatFile = read('components/chat/ChatOrderActions.jsx');

  // ordersColumnCard uses explicit longhand properties without flex: 0 or flex: 1
  assert.match(fileContent, /ordersColumnCard:\s*\{[^}]*flexGrow:\s*isTwoColumn\s*\?\s*1\s*:\s*0/);
  assert.match(fileContent, /ordersColumnCard:\s*\{[^}]*flexShrink:\s*isTwoColumn\s*\?\s*1\s*:\s*0/);
  assert.match(fileContent, /ordersColumnCard:\s*\{[^}]*flexBasis:\s*isTwoColumn\s*\?\s*0\s*:\s*'auto'/);
  assert.doesNotMatch(fileContent, /ordersColumnCard:\s*\{[^}]*flex:\s*(isTwoColumn|0|1)/);

  // sectionScroll never collapses: uses flexShrink: 0 and flexBasis: 'auto'
  assert.match(fileContent, /sectionScroll:\s*\{[^}]*width:\s*'100%'[^}]*flexGrow:\s*1[^}]*flexShrink:\s*0[^}]*flexBasis:\s*'auto'/);
  assert.match(fileContent, /sectionContent:\s*\{[^}]*flexGrow:\s*1[^}]*flexShrink:\s*0/);

  // overviewActionButton uses longhand properties without mixing flex shorthand with flexShrink
  assert.match(fileContent, /overviewActionButton:\s*\{[^}]*flexGrow:\s*width\s*<\s*440\s*\?\s*1\s*:\s*0/);
  assert.match(fileContent, /overviewActionButton:\s*\{[^}]*flexShrink:\s*1/);
  assert.match(fileContent, /overviewActionButton:\s*\{[^}]*flexBasis:\s*'auto'/);
  assert.doesNotMatch(fileContent, /overviewActionButton:\s*\{[^}]*flex:\s*width/);

  // branchOrdersPillGroup does not use invalid flex: 'none'
  assert.doesNotMatch(fileContent, /branchOrdersPillGroup:\s*\{[^}]*flex:\s*width\s*<\s*768\s*\?\s*'none'/);
  assert.match(fileContent, /branchOrdersPillGroup:\s*\{[^}]*flexGrow:\s*width\s*<\s*768\s*\?\s*0\s*:\s*1/);

  // managerChatButton has explicit flexGrow: 0, flexShrink: 0, flexBasis: 38
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*flexGrow:\s*0/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*flexShrink:\s*0/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*flexBasis:\s*38/);

  // ChatOrderActions provides iconOnlyButton overriding flexGrow and flexBasis
  assert.match(chatFile, /iconOnlyButton:\s*\{[^}]*flexGrow:\s*0/);
  assert.match(chatFile, /iconOnlyButton:\s*\{[^}]*flexShrink:\s*0/);
  assert.match(chatFile, /iconOnlyButton:\s*\{[^}]*flexBasis:\s*'auto'/);
});

test('Compact Action Controls: Visual heights 36-40px, touch targets >= 44px, no rigid flexBasis', () => {
  const fileContent = read('app/manager/request.jsx');

  // ManagerActionButton hitSlop for touch target >= 44x44
  assert.match(fileContent, /hitSlop\s*\|\|\s*\{\s*top:\s*4,\s*bottom:\s*4,\s*left:\s*4,\s*right:\s*4\s*\}/);

  // actionButton styles
  assert.match(fileContent, /actionButton:\s*\{[^}]*height:\s*38/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*minHeight:\s*38/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*maxHeight:\s*40/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*paddingHorizontal:\s*10/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*borderRadius:\s*10/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*flexShrink:\s*1/);
  assert.doesNotMatch(fileContent, /actionButton:\s*\{[^}]*flexBasis:\s*138/);

  // chatActionWrap and managerChatButton
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*height:\s*44/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*width:\s*44/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*height:\s*38/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*width:\s*38/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*borderRadius:\s*10/);

  // actionRow and groups allow controlled wrap without horizontal clipping
  assert.match(fileContent, /actionRow:\s*\{[^}]*flexWrap:\s*['"]wrap['"]/);
  assert.match(fileContent, /actionSecondaryGroup:\s*\{[^}]*flexWrap:\s*['"]wrap['"]/);
  assert.match(fileContent, /actionDecisionGroup:\s*\{[^}]*flexWrap:\s*['"]wrap['"]/);
});

test('Dark Mode & Theme Consistency: ChatOrderActions uses theme tokens without hardcoded light styles', () => {
  const chatFile = read('components/chat/ChatOrderActions.jsx');

  // Secondary button uses dynamic theme colors
  assert.match(chatFile, /backgroundColor:\s*colors\.surface/);
  assert.match(chatFile, /borderColor:\s*colors\.primary/);

  // Focus and hover match ManagerActionButton
  assert.match(chatFile, /hovered:\s*\{\s*opacity:\s*0\.9\s*\}/);
  assert.match(chatFile, /pressed:\s*\{\s*opacity:\s*0\.8\s*\}/);
  assert.doesNotMatch(chatFile, /transform:\s*\[\s*\{\s*scale:\s*0\.985\s*\}\s*\]/);

  // Icon only chat button has accessible hitSlop and accessible labels
  assert.match(chatFile, /iconOnly\s*\?\s*\{\s*top:\s*3,\s*bottom:\s*3,\s*left:\s*3,\s*right:\s*3\s*\}\s*:\s*undefined/);
  assert.match(chatFile, /accessibilityLabel\s*=\s*['"]Message requester['"]/);
  assert.match(chatFile, /tooltip\s*=\s*['"]Message requester['"]/);
});
