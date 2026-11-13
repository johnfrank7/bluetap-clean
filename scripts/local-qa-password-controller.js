// Private, emulator-only mail capture for an interactive local-QA session.
// Codes remain in this process and can only be copied from its own terminal.
const { fork, spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const { assertLocalQaServerEnvironment } = require('../backend/config/localQaIsolation');

if (process.env.BLUETAP_QA_REUSABLE_ACCOUNTS !== '1' ||
    process.env.BLUETAP_QA_PASSWORD_MAIL !== '1' || !assertLocalQaServerEnvironment()) {
  throw new Error('The local mail controller requires explicit isolated QA.');
}
const roles = ['requester', 'distributor', 'manager', 'admin'];
const recipients = new Map();
for (const role of roles) {
  const email = String(process.env[`BLUETAP_QA_${role.toUpperCase()}_EMAIL`] || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@example\.test$/.test(email) || recipients.has(email)) {
    throw new Error('The local mail controller requires distinct disposable accounts.');
  }
  recipients.set(email, role);
}
const inbox = new Map();
const child = fork(path.join(__dirname, 'local-qa-admin-drafts.js'), [], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
child.on('message', (message) => {
  const role = recipients.get(String(message?.recipient || '').toLowerCase());
  if (message?.type !== 'local-qa-password-mail' || !role || !/^\d{6}$/.test(String(message.code || ''))) return;
  inbox.set(role, message.code);
  console.log(`A local password code is ready. To copy it, type: copy otp ${role}`);
});
child.on('exit', (code) => { process.exitCode = code || 0; input.close(); });
const input = createInterface({ input: process.stdin, terminal: false });
input.on('line', (line) => {
  const match = /^copy otp (requester|distributor|manager|admin)$/i.exec(line.trim());
  if (!match) return;
  const code = inbox.get(match[1].toLowerCase());
  if (!code) { console.log('No local password code is available for that role.'); return; }
  const copy = spawn('powershell.exe', ['-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard'],
    { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  copy.on('error', () => console.error('Could not copy the local password code.'));
  copy.on('exit', (status) => console.log(status === 0 ? 'Copied the local password code to your clipboard.' : 'Could not copy the local password code.'));
  copy.stdin.on('error', () => {});
  copy.stdin.end(code);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); input.close(); });
