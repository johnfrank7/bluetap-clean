const ROLE_THEME_TOKENS = Object.freeze({
  light: Object.freeze({
    requesterRole: '#EAF6FF',
    requesterRoleText: '#1565C0',
    distributorRole: '#E5F7F3',
    distributorRoleText: '#0F766E',
    managerRole: '#F2EDFF',
    managerRoleText: '#6D28D9',
  }),
  dark: Object.freeze({
    requesterRole: '#163B59',
    requesterRoleText: '#70BDF2',
    distributorRole: '#103D3B',
    distributorRoleText: '#5EEAD4',
    managerRole: '#31264A',
    managerRoleText: '#D8B4FE',
  }),
});

const ROLE_PRESENTATION = Object.freeze({
  admin: Object.freeze({ label: 'Admin', backgroundToken: 'primarySoft', textToken: 'primary' }),
  requester: Object.freeze({ label: 'Requester', backgroundToken: 'requesterRole', textToken: 'requesterRoleText' }),
  distributor: Object.freeze({ label: 'Distributor', backgroundToken: 'distributorRole', textToken: 'distributorRoleText' }),
  manager: Object.freeze({ label: 'Manager', backgroundToken: 'managerRole', textToken: 'managerRoleText' }),
});

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const roleToneFor = (role) => {
  const normalized = normalizeRole(role);
  return ROLE_PRESENTATION[normalized] && normalized !== 'admin' ? `${normalized}Role` : 'blue';
};

const roleFromTone = (tone) => {
  const match = /^(requester|distributor|manager)Role$/.exec(String(tone || ''));
  return match ? match[1] : '';
};

const getRolePresentation = (role, colors = {}) => {
  const normalized = normalizeRole(role);
  const definition = ROLE_PRESENTATION[normalized] || ROLE_PRESENTATION.admin;
  return {
    role: normalized || 'admin',
    label: definition.label,
    backgroundColor: colors[definition.backgroundToken] || colors.primarySoft || '#EAF6FF',
    color: colors[definition.textToken] || colors.primary || '#1565C0',
  };
};

module.exports = {
  getRolePresentation,
  normalizeRole,
  roleFromTone,
  roleToneFor,
  ROLE_PRESENTATION,
  ROLE_THEME_TOKENS,
};
