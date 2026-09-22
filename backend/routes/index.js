const { createOtpHandler } = require('../auth/otpHandler');
const { createRegistrationHandler } = require('../registration/registrationHandler');
const { createRegistrationSessionHandler } = require('../registration/registrationSessionHandler');
const { createUsernameHandler } = require('../username/usernameHandler');
const { createFaceVerificationHandler } = require('../verification/faceVerification');
const { createRegistrationFaceHandler } = require('../verification/registrationFaceHandler');
const { createFaceServiceStatusHandler } = require('../verification/faceServiceStatusHandler');
const { createFaceServiceWarmupHandler } = require('../verification/faceServiceWarmupHandler');
const { createAdminRegistrationSecurityHandler } = require('../admin/registrationSecurityHandler');
const { createAdminBranchesHandler, createAdminManagersHandler } = require('../admin/branchManagementHandler');
const { createRequiredPasswordChangeHandler } = require('../auth/requiredPasswordChangeHandler');
const { createPasswordRecoveryHandler } = require('../auth/passwordRecoveryHandler');
const { createManagerContextHandler } = require('../manager/managerContextHandler');
const { createOutsideRadiusApprovalsHandler } = require('../manager/outsideRadiusApprovalHandler');
const { createManagerDispatchHandler } = require('../manager/dispatchHandler');
const { createDistributorAssignedOrdersHandler } = require('../distributor/assignedOrdersHandler');
const { createAdminAccountsHandler } = require('../admin/accountManagementHandler');
const { createAdminDistributorsHandler } = require('../admin/distributorManagementHandler');
const { createSessionPolicyHandler } = require('../auth/sessionPolicyHandler');
const { createAdminDashboardOverviewHandler } = require('../admin/dashboardOverviewHandler');
const { createAdminProductsHandler } = require('../admin/productManagementHandler');
const { createRequesterCatalogHandler, createRequesterOrdersHandler } = require('../requester/orderingHandler');

const routes = new Map([
  ['/api/auth/check-username', createUsernameHandler('check')],
  ['/api/auth/login-with-username', createUsernameHandler('login')],
  ['/api/auth/create-registration-session', createRegistrationSessionHandler('create')],
  ['/api/auth/registration-branches', createRegistrationSessionHandler('branches')],
  ['/api/auth/registration-policy', createRegistrationSessionHandler('policy')],
  ['/api/auth/registration-session-status', createRegistrationSessionHandler('status')],
  ['/api/auth/start-registration-face-verification', createRegistrationSessionHandler('start')],
  ['/api/auth/accept-registration-terms', createRegistrationSessionHandler('terms')],
  ['/api/auth/request-email-otp', createOtpHandler('request')],
  ['/api/auth/verify-email-otp', createOtpHandler('verify')],
  ['/api/auth/request-registration-otp', createRegistrationHandler('request')],
  ['/api/auth/complete-registration', createRegistrationHandler('complete')],
  ['/api/verification/verify-face', createFaceVerificationHandler()],
  ['/api/verification/registration-face', createRegistrationFaceHandler()],
  ['/api/verification/face-service-status', createFaceServiceStatusHandler()],
  ['/api/verification/warm-face-service', createFaceServiceWarmupHandler()],
  ['/api/admin/registration-security', createAdminRegistrationSecurityHandler()],
  ['/api/admin/branches', createAdminBranchesHandler()],
  ['/api/admin/managers', createAdminManagersHandler()],
  ['/api/admin/accounts', createAdminAccountsHandler()],
  ['/api/admin/distributors', createAdminDistributorsHandler()],
  ['/api/admin/dashboard/overview', createAdminDashboardOverviewHandler()],
  ['/api/admin/products', createAdminProductsHandler()],
  ['/api/requester/catalog', createRequesterCatalogHandler()],
  ['/api/requester/orders', createRequesterOrdersHandler()],
  ['/api/manager/context', createManagerContextHandler()],
  ['/api/manager/outside-radius-orders', createOutsideRadiusApprovalsHandler()],
  ['/api/manager/dispatch-orders', createManagerDispatchHandler()],
  ['/api/distributor/orders', createDistributorAssignedOrdersHandler()],
  ['/api/auth/complete-required-password-change', createRequiredPasswordChangeHandler()],
  ['/api/auth/password-recovery', createPasswordRecoveryHandler()],
  ['/api/auth/session-policy', createSessionPolicyHandler()],
]);

module.exports = { routes };
