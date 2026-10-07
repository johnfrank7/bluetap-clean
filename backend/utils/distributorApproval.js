/**
 * backend/utils/distributorApproval.js
 *
 * Backwards compatibility adapter delegating to canonical distributorApplicationService.
 */

const {
  activeBranchInTransaction,
  approveDistributorApplicationInTransaction,
  isPendingStatus,
  normalizeDistributorStatus,
  rejectDistributorApplicationInTransaction,
  statusOf,
} = require('../distributor/distributorApplicationService');

module.exports = {
  activeBranchInTransaction,
  approveDistributorInTransaction: approveDistributorApplicationInTransaction,
  isPendingStatus,
  normalizeDistributorStatus,
  rejectDistributorInTransaction: rejectDistributorApplicationInTransaction,
  statusOf,
};
