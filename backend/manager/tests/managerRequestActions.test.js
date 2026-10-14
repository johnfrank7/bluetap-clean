const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('Manager requests: Upcoming orders queue includes ManagerOrderChatAction', () => {
  const fileContent = read('app/manager/request.jsx');

  // Verify ManagerOrderChatAction import
  assert.match(fileContent, /import\s*\{\s*ManagerOrderChatAction\s*\}\s*from\s*['"]\.\.\/\.\.\/components\/chat\/ChatOrderActions['"]/);

  // In ReceivedRequestsQueue (Upcoming / Normal Orders)
  const receivedQueueSection = fileContent.slice(
    fileContent.indexOf('function ReceivedRequestsQueue'),
    fileContent.indexOf('function BranchOrdersOverview')
  );

  assert.ok(receivedQueueSection.length > 0, 'ReceivedRequestsQueue section must exist');
  assert.match(receivedQueueSection, /<ManagerOrderChatAction\s+order=\{order\}\s+disabled=\{entry\.actionsDisabled\}\s+style=\{styles\.managerChatButton\}\s*\/>/);
});

test('Manager requests: Delivery exceptions queue includes ManagerOrderChatAction', () => {
  const fileContent = read('app/manager/request.jsx');

  // In OutsideRadiusApprovalQueue (Delivery Exceptions)
  const outsideRadiusSection = fileContent.slice(
    fileContent.indexOf('function OutsideRadiusApprovalQueue'),
    fileContent.indexOf('function EditOrderModal')
  );

  assert.ok(outsideRadiusSection.length > 0, 'OutsideRadiusApprovalQueue section must exist');
  assert.match(outsideRadiusSection, /<ManagerOrderChatAction\s+order=\{order\}\s+disabled=\{entry\.actionsDisabled\}\s+style=\{styles\.managerChatButton\}\s*\/>/);
});

test('Manager requester message action uses a centered concise label', () => {
  const fileContent = read('components/chat/ChatOrderActions.jsx');
  const managerActionStart = fileContent.indexOf('export function ManagerOrderChatAction');
  const managerActionEnd = fileContent.indexOf('\n}\n', managerActionStart);
  const managerAction = fileContent.slice(managerActionStart, managerActionEnd);
  assert.match(managerAction, /label="Message"/);
  assert.match(fileContent, /button:\s*\{[^}]*alignItems:\s*'center'[^}]*justifyContent:\s*'center'/);
});

test('Manager request action buttons expose web hover and pressed feedback without changing handlers', () => {
  const fileContent = read('app/manager/request.jsx');
  assert.match(fileContent, /function ManagerActionButton\([\s\S]*?hovered && !disabled && \{ opacity: 0\.9 \}[\s\S]*?pressed && !disabled && \{ opacity: 0\.8 \}/);
  assert.match(fileContent, /function ManagerActionButton\([\s\S]*?const baseStyle = StyleSheet\.flatten\(style\)/);
  assert.match(fileContent, /<ManagerActionButton disabled=\{entry\.actionsDisabled\} onPress=\{\(\) => onOpenOrder\(order\)\}/);
  assert.match(fileContent, /<ManagerActionButton[\s\S]*?onPress=\{\(\) => decide\(order, 'approve'\)\}/);
  assert.match(fileContent, /<ManagerActionButton[\s\S]*?onPress=\{\(\) => act\(order\.id, 'accept-transfer'\)\}/);
  assert.match(fileContent, /<ManagerActionButton disabled=\{entry\.actionsDisabled\} onPress=\{\(\) => onOpenOrder\(order\)\}/);
});

test('Manager requests: actionRow enforces centered alignment and consistent 44-48px button heights', () => {
  const fileContent = read('app/manager/request.jsx');

  // actionRow must have alignItems: 'center' instead of 'stretch' to prevent ballooning
  assert.match(fileContent, /actionRow:\s*\{[^}]*alignItems:\s*['"]center['"]/);
  assert.doesNotMatch(fileContent, /actionRow:\s*\{[^}]*alignItems:\s*['"]stretch['"]/);

  // chatActionWrap must enforce 44-48px height and responsive flexBasis
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*height:\s*44/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*flexBasis:\s*width\s*<\s*430\s*\?\s*['"]48%['"]\s*:\s*138/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*flexGrow:\s*width\s*<\s*430\s*\?\s*1\s*:\s*0/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*flexShrink:\s*0/);

  // actionButton must enforce 44-48px height and responsive flexBasis
  assert.match(fileContent, /actionButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*height:\s*44/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*flexBasis:\s*width\s*<\s*430\s*\?\s*['"]48%['"]\s*:\s*138/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*flexGrow:\s*width\s*<\s*430\s*\?\s*1\s*:\s*0/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*flexShrink:\s*0/);

  // managerChatButton must enforce matching height
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*height:\s*44/);
});

test('Manager request cards keep desktop actions compact and preserve their action handlers', () => {
  const fileContent = read('app/manager/request.jsx');
  assert.equal((fileContent.match(/<View style=\{styles\.productPricingRow\}>/g) || []).length, 4);
  assert.match(fileContent, /productPricingRow:\s*\{[^}]*flexDirection:\s*width\s*<\s*550\s*\?\s*'column'\s*:\s*'row'/);
  assert.match(fileContent, /<Text style=\{styles\.totalLabel\}>ORDER TOTAL<\/Text>/);
  assert.match(fileContent, /styles\.deliveryFeeText\}>Includes \{formatAmount\(order\.deliveryFeeAtOrder\)\} delivery/);
  assert.match(fileContent, /decide\(order, 'accept-order'\)/);
  assert.match(fileContent, /decide\(entry\.item, 'reject-order'\)/);
  assert.match(fileContent, /onOpenOrder\(order\)/);
  assert.match(fileContent, /ManagerOrderChatAction order=\{order\}/);
  const queueStart = fileContent.indexOf('function ReceivedRequestsQueue');
  const queueEnd = fileContent.indexOf('function BranchOrdersOverview', queueStart);
  const requestQueue = fileContent.slice(queueStart, queueEnd);
  assert.equal((requestQueue.match(/Delivery: \{order\.address/g) || []).length, 1);
  assert.equal((requestQueue.match(/Distance: \{orderDistance\(order\)\}/g) || []).length, 1);
  assert.match(requestQueue, /styles\.requestProductInfo[\s\S]*Delivery: \{order\.address \|\| 'Address provided'\}[\s\S]*Distance: \{orderDistance\(order\)\}[\s\S]*styles\.orderTotalSummary/);
  assert.match(requestQueue, /styles\.requestDeliveryInfo/);
  assert.match(requestQueue, /<View style=\{\[styles\.actionRow, styles\.requestActionRow\]\}>/);
  assert.match(fileContent, /requestDeliveryInfo:\s*\{[^}]*marginTop:\s*4/);
  assert.match(fileContent, /requestActionRow:\s*\{[^}]*borderTopWidth:\s*1[^}]*borderTopColor:\s*colors\.border[^}]*paddingTop:\s*10/);
});

test('Manager dispatch controls keep pricing centered and buttons side-by-side when space permits', () => {
  const fileContent = read('app/manager/distributors.jsx');
  assert.match(fileContent, /dispatchProductPricingRow:\s*\{[^}]*flexDirection:\s*width\s*<\s*550\s*\?\s*'column'\s*:\s*'row'/);
  assert.match(fileContent, /dispatchOrderTotal:\s*\{[^}]*minWidth:\s*width\s*<\s*550\s*\?\s*0\s*:\s*160/);
  assert.match(fileContent, /dispatchDeliveryInfo:\s*\{[^}]*marginTop:\s*4/);
  const dispatchQueue = fileContent.slice(fileContent.indexOf('function DistributorDispatchQueue'), fileContent.indexOf('export default function ManagerDistributorsPage'));
  assert.equal((dispatchQueue.match(/Delivery: \{order\.address/g) || []).length, 1);
  assert.equal((dispatchQueue.match(/Distance: \{orderDistance\(order\)\}/g) || []).length, 1);
  assert.match(dispatchQueue, /dispatchProductInfo[\s\S]*Delivery: \{order\.address[\s\S]*Distance: \{orderDistance\(order\)\}[\s\S]*dispatchOrderTotal/);
  assert.doesNotMatch(dispatchQueue, /<View style=\{styles\.deliveryInfo\}>/);
  assert.match(fileContent, /dispatchActions:\s*\{[^}]*flexDirection:\s*width\s*<\s*550\s*\?\s*'column'\s*:\s*'row'/);
  assert.match(fileContent, /dispatchActions:\s*\{[^}]*width:\s*width\s*<\s*550\s*\?\s*'100%'\s*:\s*328/);
  for (const styleName of ['assignButton', 'transferButton']) {
    const stylePattern = new RegExp(`${styleName}:\\s*\\{[^}]*minHeight:\\s*44[^}]*minWidth:\\s*width\\s*<\\s*550\\s*\\?\\s*0\\s*:\\s*156[^}]*flexShrink:\\s*0`);
    assert.match(fileContent, stylePattern, `${styleName} should retain readable width without shrinking`);
  }
  const productRowStart = fileContent.indexOf('<View style={styles.dispatchProductPricingRow}>');
  const totalPosition = fileContent.indexOf('<View style={styles.dispatchOrderTotal}>', productRowStart);
  const infoRowStart = fileContent.indexOf('<View style={styles.dispatchInfoBlock}>', productRowStart);
  const actionPosition = fileContent.indexOf('<View style={styles.dispatchActions}>', infoRowStart);
  const detailsPosition = fileContent.indexOf('<View style={styles.approvalDetails}>', infoRowStart);
  assert.ok(productRowStart >= 0 && totalPosition > productRowStart && infoRowStart > totalPosition && actionPosition > infoRowStart && detailsPosition > actionPosition);
  assert.match(fileContent, /onPress=\{\(\) => \(isPanelOpen \? setAssigningOrderId\(''\) : openAssignmentPanel\(order\)\)\}/);
  assert.match(fileContent, /dispatchManagerOrder\(order\.id, isReassign \? 'reassign-distributor' : 'assign-distributor'/);
  assert.match(fileContent, /dispatchManagerOrder\(orderId, 'request-transfer'/);
});

test('Manager order cards use compact product-to-delivery and delivery-to-action spacing', () => {
  const requests = read('app/manager/request.jsx');
  const distributors = read('app/manager/distributors.jsx');
  assert.match(requests, /productPricingRow:\s*\{[^}]*marginTop:\s*8/);
  assert.match(requests, /detailsBlock:\s*\{[^}]*marginTop:\s*4/);
  assert.match(requests, /actionRow:\s*\{[^}]*marginTop:\s*8/);
  assert.match(distributors, /dispatchProductPricingRow:\s*\{[^}]*marginTop:\s*8/);
  assert.match(distributors, /dispatchInfoBlock:\s*\{[^}]*marginTop:\s*10[^}]*paddingTop:\s*10[^}]*borderTopWidth:\s*1[^}]*borderTopColor:\s*colors\.border[^}]*width:\s*'100%'/);
});

test('Manager exception, branch-management, and transfer cards share compact content hierarchy', () => {
  const fileContent = read('app/manager/request.jsx');
  const exceptionsStart = fileContent.indexOf('function OutsideRadiusApprovalQueue');
  const exceptionsEnd = fileContent.indexOf('function EditOrderModal', exceptionsStart);
  const exceptions = fileContent.slice(exceptionsStart, exceptionsEnd);
  const branchStart = fileContent.indexOf('function BranchOrdersOverview');
  const branchEnd = fileContent.indexOf('export default function ManagerRequestPage', branchStart);
  const branchOrders = fileContent.slice(branchStart, branchEnd);
  const transfersStart = fileContent.indexOf('function BranchTransfersQueue');
  const transfersEnd = fileContent.indexOf('function ReceivedRequestsQueue', transfersStart);
  const transfers = fileContent.slice(transfersStart, transfersEnd);

  for (const [name, section] of [['exceptions', exceptions], ['branch orders', branchOrders], ['transfers', transfers]]) {
    assert.match(section, /styles\.orderHeaderRow/, `${name} should use the shared top row`);
    assert.match(section, /styles\.requestProductInfo[\s\S]*styles\.requestDeliveryInfo[\s\S]*styles\.orderTotalSummary/, `${name} should group product and delivery metadata beside the total`);
    assert.match(section, /styles\.requestActionRow/, `${name} actions should use the shared separated action row`);
  }

  assert.match(exceptions, /Delivery: \{order\.address/);
  assert.match(exceptions, /Distance: Approx\./);
  assert.match(exceptions, /onPress=\{\(\) => decide\(order, 'approve'\)\}/);
  assert.match(branchOrders, /Delivery: \{order\.address/);
  assert.match(branchOrders, /Distance: \{orderDistance\(order\)\}/);
  assert.match(branchOrders, /onPress=\{\(\) => onOpenOrder\(order\)\}/);
  assert.match(transfers, /Destination: \{order\.transferToBranchName\}/);
  assert.match(transfers, /onPress=\{\(\) => act\(order\.id, 'accept-transfer'\)\}/);
  assert.match(transfers, /title="No transfer requests"[\s\S]*style=\{styles\.inlineVisualEmpty\}/);
  assert.match(transfers, /title="No transfer updates yet"[\s\S]*style=\{styles\.inlineVisualEmpty\}/);
  assert.match(fileContent, /inlineVisualEmpty:\s*\{[^}]*minHeight:\s*96[^}]*marginVertical:\s*4/);
  assert.match(fileContent, /decisionItem:\s*\{[^}]*padding:\s*14[^}]*marginBottom:\s*10/);
});
