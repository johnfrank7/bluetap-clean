const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { loadRegistrationSecurity } = require('../registration/registrationSecurity');
const { logDevelopmentTiming } = require('../utils/performanceLog');
const { ACCOUNT_STATUS, canonicalAccountStatus } = require('../auth/accountStatus');

const ACCOUNT_ROLES = new Set(['requester', 'distributor', 'manager']);
const clean = (value, max = 160) => String(value || '').trim().slice(0, max);
const timeOf = (value) => value?.toMillis?.() || Number(value?.seconds || 0) * 1000 || new Date(value || 0).getTime() || 0;

async function timed(stage, operation) {
  const startedAt = Date.now();
  try { return await operation(); }
  finally { logDevelopmentTiming('[admin-performance]', { stage, durationMs: Date.now() - startedAt }); }
}

function accountStatus(data = {}) {
  const globalStatus = canonicalAccountStatus(data);
  if (globalStatus !== ACCOUNT_STATUS.ACTIVE) return globalStatus;
  if (data.role === 'manager') return clean(data.managerStatus || 'inactive', 30).toLowerCase();
  if (data.role === 'distributor') return clean(data.distributorStatus || data.approvalStatus || data.status || 'pending', 30).toLowerCase();
  return clean(data.accountStatus || data.status || 'active', 30).toLowerCase();
}

function deliveredOrderStats(order = {}) {
  const status = clean(order.status, 60).toLowerCase().replace(/[\s-]+/g, '_');
  if (status !== 'delivered') return { deliveredOrders: 0, revenue: 0, units: 0 };
  const items = Array.isArray(order.items) ? order.items : [];
  const units = items.length ? items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : Number(order.quantity || 0);
  const itemRevenue = items.reduce((sum, item) => sum + (Number(item.totalAtOrder ?? item.line_total ?? (Number(item.unitPriceAtOrder || 0) * Number(item.quantity || 0))) || 0), 0);
  const revenue = Number(order.totalAtOrder ?? order.total_cost ?? itemRevenue) || 0;
  return { deliveredOrders: 1, revenue, units };
}

function createAdminDashboardOverviewHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    const startedAt = Date.now();
    try {
      const { auth, db } = getAdmin();
      await requireAdmin(req, auth, db);
      const [branchResult, userResult, securityResult, requestResult] = await Promise.allSettled([
        timed('ADMIN_OVERVIEW_BRANCHES_READ', () => db.collection('branches').get()),
        timed('ADMIN_OVERVIEW_USERS_READ', () => db.collection('users').get()),
        timed('ADMIN_OVERVIEW_SECURITY_READ', () => loadRegistrationSecurity(db)),
        timed('ADMIN_OVERVIEW_REQUESTS_READ', () => db.collection('requests').orderBy('createdAt', 'desc').limit(500).get()),
      ]);

      const errors = {};
      const branchDocs = branchResult.status === 'fulfilled' ? branchResult.value.docs : [];
      const userDocs = userResult.status === 'fulfilled' ? userResult.value.docs : [];
      if (branchResult.status === 'rejected') errors.branches = 'Branch overview is temporarily unavailable.';
      if (userResult.status === 'rejected') errors.accounts = 'Account overview is temporarily unavailable.';
      if (securityResult.status === 'rejected') errors.security = 'Security overview is temporarily unavailable.';
      if (requestResult.status === 'rejected') errors.sales = 'Sales overview is temporarily unavailable.';

      const accounts = userDocs
        .map((doc) => ({ uid: doc.id, ...doc.data() }))
        .filter((profile) => ACCOUNT_ROLES.has(profile.role));
      const managersByBranch = new Map();
      accounts.filter((profile) => profile.role === 'manager' && profile.branchId).forEach((profile) => {
        managersByBranch.set(profile.branchId, (managersByBranch.get(profile.branchId) || 0) + 1);
      });
      const branches = branchDocs.map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          name: clean(data.name),
          code: clean(data.code, 24),
          city: clean(data.city),
          status: data.status === 'inactive' ? 'inactive' : 'active',
          managerCount: managersByBranch.get(doc.id) || 0,
          createdAt: data.createdAt || null,
        };
      }).sort((left, right) => left.name.localeCompare(right.name));

      const recentActivity = [
        ...accounts.map((profile) => ({ type: 'Account created', name: clean(profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`) || clean(profile.email), date: profile.createdAt || null })),
        ...branches.map((branch) => ({ type: 'Branch created', name: branch.name, date: branch.createdAt })),
      ].sort((left, right) => timeOf(right.date) - timeOf(left.date)).slice(0, 5);
      const security = securityResult.status === 'fulfilled' ? securityResult.value : null;
      const activeAccounts = accounts.filter((profile) => !['inactive', 'rejected'].includes(accountStatus(profile))).length;
      const countRole = (role) => accounts.filter((profile) => profile.role === role).length;
      const sales = requestResult.status === 'fulfilled'
        ? requestResult.value.docs.reduce((total, doc) => {
            const stats = deliveredOrderStats(doc.data() || {});
            return { deliveredOrders: total.deliveredOrders + stats.deliveredOrders, revenue: total.revenue + stats.revenue, units: total.units + stats.units, scope: 'Recent 500 orders' };
          }, { deliveredOrders: 0, revenue: 0, units: 0, scope: 'Recent 500 orders' })
        : null;

      logDevelopmentTiming('[admin-performance]', { stage: 'ADMIN_DASHBOARD_OVERVIEW_FINISHED', durationMs: Date.now() - startedAt });
      return res.status(200).json({
        summary: {
          totalBranches: branchResult.status === 'fulfilled' ? branches.length : null,
          activeBranches: branchResult.status === 'fulfilled' ? branches.filter((branch) => branch.status === 'active').length : null,
          totalAccounts: userResult.status === 'fulfilled' ? accounts.length : null,
          activeAccounts: userResult.status === 'fulfilled' ? activeAccounts : null,
          managers: userResult.status === 'fulfilled' ? countRole('manager') : null,
          requesters: userResult.status === 'fulfilled' ? countRole('requester') : null,
          distributors: userResult.status === 'fulfilled' ? countRole('distributor') : null,
          pendingDistributors: userResult.status === 'fulfilled' ? accounts.filter((profile) => profile.role === 'distributor' && accountStatus(profile) === 'pending').length : null,
        },
        branches: branches.slice(0, 5),
        recentActivity,
        security: security ? {
          faceVerificationEnabled: security.faceVerificationEnabled,
          emailOtpEnabled: security.emailOtpEnabled,
          maxAccountsPerDevice: security.maxAccountsPerDevice,
          maxAccountsPerIp: security.maxAccountsPerIp,
        } : null,
        sales,
        errors,
      });
    } catch (error) {
      const known = error instanceof OtpError;
      return res.status(known ? error.status : 500).json({ error: {
        reason: known ? error.reason : 'service-unavailable',
        message: known ? error.message : 'The Admin dashboard overview is temporarily unavailable.',
      } });
    }
  };
}

module.exports = { createAdminDashboardOverviewHandler, deliveredOrderStats };
