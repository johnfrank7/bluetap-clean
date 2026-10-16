const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { transformSync } = require('@babel/core');
const { runInNewContext } = require('node:vm');

const root = resolve(__dirname, '../../..');

function playback() {
  const calls = [];
  const animation = (kind, options) => {
    const instance = { kind, options, started: false, stopped: false,
      start(callback) { this.started = true; this.callback = callback; },
      stop() { this.stopped = true; },
      finish(finished = true) { this.callback?.({ finished }); },
    };
    calls.push(instance);
    return instance;
  };
  const Animated = {
    timing: (value, options) => animation('timing', options),
    delay: (duration) => animation('delay', { duration }),
    sequence: (children) => animation('sequence', children),
    loop: (child) => animation('loop', child),
  };
  const exports = {};
  const { code } = transformSync(readFileSync(resolve(root, 'components/blueTapLiquidMotion.js'), 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  runInNewContext(code, { exports, require: () => ({ Animated, Easing: { linear: 'linear', sin: 'sin', inOut: (x) => x } }) });
  const value = () => ({ current: 0, stopped: false,
    setValue(v) { this.current = v; }, stopAnimation() { this.stopped = true; },
  });
  const progress = value();
  const breathing = value();
  let refined = 0;
  const stop = exports.startLiquidFormation(progress, breathing, () => { refined += 1; });
  return { calls, progress, breathing, stop, refined: () => refined };
}

test('liquid formation settles once at 1850ms; breathing starts only after the 2200ms final hold', () => {
  const p = playback();
  const formation = p.calls[0];
  const hold = p.calls.find((x) => x.kind === 'delay');
  const loop = p.calls.find((x) => x.kind === 'loop');
  assert.equal(formation.options.duration, 1850);
  assert.equal(formation.options.toValue, 1850);
  assert.equal(formation.started, true);
  assert.equal(loop.started, false);
  formation.finish();
  assert.equal(p.refined(), 1);
  assert.equal(hold.started, true);
  assert.equal(hold.options.duration, 350);
  assert.equal(loop.started, false);
  hold.finish();
  assert.equal(loop.started, true);
  for (const call of p.calls.filter((x) => x.kind === 'timing')) {
    assert.equal(call.options.useNativeDriver, true);
    assert.equal(call.options.isInteraction, false);
  }
  p.stop();
  assert.equal(loop.stopped, true);
});

test('early readiness/unmount cancels formation and ignores delayed completion callbacks', () => {
  const p = playback();
  p.stop();
  p.calls[0].finish();
  assert.equal(p.refined(), 0);
  assert.equal(p.calls.find((x) => x.kind === 'delay').started, false);
  assert.equal(p.calls.find((x) => x.kind === 'loop').started, false);
  assert.equal(p.progress.stopped, true);
  assert.equal(p.breathing.stopped, true);
});

test('unmount during final hold cannot start a background breathing loop', () => {
  const p = playback();
  p.calls[0].finish();
  p.stop();
  p.calls.find((x) => x.kind === 'delay').finish();
  assert.equal(p.calls.find((x) => x.kind === 'loop').started, false);
});

test('interrupted animation never advances to the final hold', () => {
  const p = playback();
  p.calls[0].finish(false);
  assert.equal(p.refined(), 0);
  assert.equal(p.calls.find((x) => x.kind === 'delay').started, false);
  p.stop();
});

test('RoleGate retains custom skeletons and errors, with no animation completion dependency', () => {
  const gate = readFileSync(resolve(root, 'components/RoleGate.jsx'), 'utf8');
  assert.match(gate, /if \(isChecking && loadingFallback\) return loadingFallback;\s*if \(isChecking\) return <BlueTapLiquidLoader role=\{sessionRole\} \/>;/);
  assert.match(gate, /<Text style=\{styles.message\}>\{gateState.message\}<\/Text>/);
  assert.doesNotMatch(gate, /onRefined|LIQUID_FINISH|setTimeout\([^]*2200/);
});
