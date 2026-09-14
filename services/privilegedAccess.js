function hasTrustedRole(expectedRole, claims = {}, profile = {}) {
  const role = String(expectedRole || '').trim().toLowerCase();
  if (!['admin', 'manager'].includes(role) || profile?.role !== role) return false;
  return role === 'admin'
    ? claims?.admin === true || claims?.role === 'admin'
    : claims?.manager === true || claims?.role === 'manager';
}

module.exports = { hasTrustedRole };
