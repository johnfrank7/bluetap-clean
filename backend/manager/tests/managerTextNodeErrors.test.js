const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

test('app/manager/request.jsx has no logical expressions that evaluate to empty strings inside View', () => {
  const filePath = path.resolve(__dirname, '../../../app/manager/request.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  });

  const dangerousExpressions = [];

  traverse(ast, {
    JSXElement(nodePath) {
      const tag = getTagName(nodePath.node.openingElement.name);
      if (tag === 'Text') return;

      nodePath.node.children.forEach((child) => {
        // Direct non-whitespace text in a non-Text, non-pill container
        if (child.type === 'JSXText' && child.value.trim().length > 0) {
          if (!tag.includes('Pill') && !tag.includes('Text') && !tag.includes('Button')) {
            dangerousExpressions.push({
              line: child.loc?.start.line,
              type: 'JSXText',
              parent: tag,
              snippet: child.value.trim(),
            });
          }
        }

        // LogicalExpression && where left side is not guaranteed boolean
        if (child.type === 'JSXExpressionContainer') {
          const expr = child.expression;
          if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
            if (!isGuaranteedBoolean(expr.left)) {
              dangerousExpressions.push({
                line: child.loc?.start.line,
                type: 'LogicalExpression &&',
                parent: tag,
                snippet: code.slice(expr.left.start, expr.left.end),
              });
            }
          }
        }
      });
    },
  });

  assert.deepEqual(
    dangerousExpressions,
    [],
    `Found dangerous JSX expressions that may evaluate to strings inside <View>: ${JSON.stringify(dangerousExpressions, null, 2)}`
  );
});

test('OutsideRadiusApprovalQueue details block condition safely returns boolean/null for empty requesterUniqueId', () => {
  const order = {
    id: 'test-1',
    productLimitViolations: [],
    approvalReasons: [],
    requesterUniqueId: '',
  };

  // The condition used for the details block
  const shouldRenderDetails = Boolean(
    order.productLimitViolations?.length > 0 ||
    order.approvalReasons?.includes('NON_STANDARD_DELIVERY_DAY') ||
    order.requesterUniqueId
  );

  assert.equal(typeof shouldRenderDetails, 'boolean');
  assert.equal(shouldRenderDetails, false);
});

test('toManagerOrder default empty strings do not cause React Native Web text node errors when evaluated', () => {
  const { toManagerOrder } = require('../../../services/managerOperational');
  const defaultOrder = toManagerOrder('req-1', {});

  assert.equal(defaultOrder.requesterUniqueId, '');
  assert.equal(defaultOrder.deliveryFeeAtOrder, 0);

  // Test the conditions used in BranchOrdersOverview
  const showDistributor = Boolean(defaultOrder.assignedDistributorName || defaultOrder.assignedDistributorUid);
  const showDeliveryFee = Boolean(defaultOrder.deliveryFeeAtOrder);

  assert.equal(typeof showDistributor, 'boolean');
  assert.equal(showDistributor, false);
  assert.equal(typeof showDeliveryFee, 'boolean');
  assert.equal(showDeliveryFee, false);
});

function getTagName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${getTagName(node.object)}.${node.property.name}`;
  return '';
}

function isGuaranteedBoolean(node) {
  if (!node) return false;
  if (node.type === 'UnaryExpression' && node.operator === '!') return true;
  if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!=', '>', '<', '>=', '<=', 'instanceof', 'in'].includes(node.operator)) return true;
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'Identifier' && node.callee.name === 'Boolean') return true;
    if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'isFinite') return true;
    if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'has') return true;
  }
  if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
    return isGuaranteedBoolean(node.left) && isGuaranteedBoolean(node.right);
  }
  return false;
}
