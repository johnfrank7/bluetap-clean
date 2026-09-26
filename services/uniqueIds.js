const PUBLIC_PREFIXES = {
  requester: 'Req',
  distributor: 'Dis',
  manager: 'Mgr',
  admin: 'Adm',
};

export const normalizeUniqueIdRole = (role) =>
  role?.toString().trim().toLowerCase() || '';

export const isPublicOrFormattedUniqueId = (id) => {
  if (!id || typeof id !== 'string') return false;
  const str = id.trim();
  const lower = str.toLowerCase();
  if (
    [
      'not set',
      'not assigned',
      'not provided',
      'n/a',
      'none',
      'unknown',
      'undefined',
      'null',
    ].includes(lower)
  ) {
    return false;
  }
  if (/^(Req|Dis|Mgr|Adm|Acc)\d+$/i.test(str)) return true;
  if (/^(REQ|DIS|MGR|ADM|ACC)-\d+$/i.test(str)) return true;
  return false;
};

export const formatDisplayUniqueId = (id, fallback = 'Not assigned') => {
  if (!id || typeof id !== 'string') return fallback;
  const str = id.trim();
  if (!isPublicOrFormattedUniqueId(str)) return fallback;

  const standardMatch = str.match(/^(Req|Dis|Mgr|Adm|Acc)(\d+)$/i);
  if (standardMatch) {
    const rawPrefix = standardMatch[1].toLowerCase();
    const prefixMap = { req: 'Req', dis: 'Dis', mgr: 'Mgr', adm: 'Adm', acc: 'Acc' };
    const prefix = prefixMap[rawPrefix] || 'Acc';
    const num = standardMatch[2].padStart(3, '0');
    return `${prefix}${num}`;
  }

  const legacyMatch = str.match(/^(REQ|DIS|MGR|ADM|ACC)-(\d+)$/i);
  if (legacyMatch) {
    const rawPrefix = legacyMatch[1].toLowerCase();
    const prefixMap = { req: 'Req', dis: 'Dis', mgr: 'Mgr', adm: 'Adm', acc: 'Acc' };
    const prefix = prefixMap[rawPrefix] || 'Acc';
    const numVal = parseInt(legacyMatch[2], 10);
    const num = String(Number.isFinite(numVal) ? numVal : 0).padStart(3, '0');
    return `${prefix}${num}`;
  }

  return str;
};

export const getProfileUniqueId = (profile = {}) => {
  const safeProfile = profile || {};

  const candidate = (
    safeProfile.publicUid ||
    safeProfile.displayUid ||
    safeProfile.unique_id ||
    safeProfile.uniqueId ||
    ''
  ).toString().trim();

  if (candidate && isPublicOrFormattedUniqueId(candidate)) {
    return formatDisplayUniqueId(candidate);
  }

  return '';
};

export const formatUniqueId = (role, number) => {
  const normRole = normalizeUniqueIdRole(role);
  const prefix = PUBLIC_PREFIXES[normRole] || 'Acc';
  return `${prefix}${String(Number(number) || 0).padStart(3, '0')}`;
};
