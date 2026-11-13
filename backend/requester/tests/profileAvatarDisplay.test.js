const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function render(props, failed = '') {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../components/ProfileAvatar.jsx'), 'utf8');
  const code = babel.transformSync(source, { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const react = { useState: () => [failed, () => {}], createElement: (type, attributes, ...children) => ({ type, attributes, children }) };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : { Image: 'Image', Text: 'Text' } });
  return module.exports.default(props);
}

test('profile image renders with a cover crop and falls back to initials for missing or failed images', () => {
  const image = render({ uri: 'https://example.test/photo.png', name: 'Sample User' });
  assert.equal(image.type, 'Image');
  assert.equal(image.attributes.style.resizeMode, 'cover');
  const empty = render({ name: 'Sample User' });
  assert.equal(empty.type, 'Text');
  assert.equal(empty.children[0], 'SU');
  const failed = render({ uri: 'https://example.test/photo.png', name: '' }, 'https://example.test/photo.png');
  assert.equal(failed.type, 'Text');
  assert.equal(failed.children[0], 'BT');
});

test('Requester and Distributor profiles display existing photos without image edit controls', () => {
  for (const file of ['app/requester/r_profile.jsx', 'app/distributor/d_profile.jsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    assert.match(source, /<ProfileAvatar/);
    assert.match(source, /profilePhotoUrl/);
    assert.doesNotMatch(source, /ImagePicker|removeImage|uploadAvatar|Remove photo|Choose photo/);
    assert.doesNotMatch(source, /auth\.currentUser\?\.photoURL/);
  }
});
