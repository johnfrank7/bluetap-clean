import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import AdminIcon from '../../components/AdminIcon';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import { TableSkeleton } from '../../components/AdminSkeleton';
import ManagerShell from '../../components/ManagerShell';
import RoleBadge from '../../components/RoleBadge';
import TopToastFeedback from '../../components/TopToastFeedback';
import { BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { BRANCH_SUSPENSION_REASONS } from '../../constants/branchSuspensionReasons';
import {
  getManagerWorkspace,
  restoreManagerBranchUser,
  suspendManagerBranchUser,
} from '../../services/managerWorkspace';
import { parseTimestamp } from '../../services/notificationTimestamp';
import {
  accountPageMeta,
  accountPageNumbers,
  accountPageSlice,
} from '../../services/adminAccountsPagination';

const titleCase = (value) =>
  String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatJoinedDate = (dateVal) => {
  if (!dateVal) return '—';
  const raw = dateVal?._seconds ? dateVal._seconds * 1000 : dateVal?.seconds ? dateVal.seconds * 1000 : dateVal;
  const parsed = parseTimestamp(raw);
  if (!parsed || Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function AccountTab({ active, label, count, onPress }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} (${count})`}
      onPress={onPress}
      style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
    >
      <Text style={[styles.tabText, active ? styles.tabTextActive : styles.tabTextInactive]}>
        {label}{' '}
        <Text style={[styles.tabCount, active ? styles.tabCountActive : styles.tabCountInactive]}>
          ({count})
        </Text>
      </Text>
    </TouchableOpacity>
  );
}

function StatusBadge({ isSuspended }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  return (
    <Text style={[styles.badge, isSuspended ? styles.badgeRed : styles.badgeGreen]}>
      {isSuspended ? 'Suspended' : 'Active'}
    </Text>
  );
}

function SelectControl({ value, options, labelFor = titleCase, onSelect, accessibilityLabel }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const [open, setOpen] = useState(false);
  const selected = labelFor(value);
  const close = () => setOpen(false);

  return (
    <>
      <TouchableOpacity
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.select}
      >
        <Text numberOfLines={1} style={styles.selectText}>
          {selected}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.selectBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close selection"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.selectMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView style={styles.selectList} keyboardShouldPersistTaps="handled">
              {options.map((option) => (
                <TouchableOpacity
                  key={String(option)}
                  accessibilityRole="option"
                  accessibilityState={{ selected: option === value }}
                  onPress={() => {
                    onSelect(option);
                    close();
                  }}
                  style={[styles.selectOption, option === value && { backgroundColor: colors.primarySoft }]}
                >
                  <Text style={[styles.selectOptionText, option === value && { color: colors.primary }]}>
                    {labelFor(option)}
                  </Text>
                  {option === value ? <Text style={styles.optionCheck}>✓</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AccountPagination({ currentPage, onPageChange, totalAccounts }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const { totalPages, start, end } = accountPageMeta(totalAccounts, currentPage);
  const hasAccounts = totalAccounts > 0;
  const pageNumbers = accountPageNumbers(currentPage, totalPages);
  const summary = hasAccounts
    ? `Showing ${start + 1}–${end} of ${totalAccounts} accounts · Page ${currentPage} of ${totalPages}`
    : 'Showing 0 accounts';

  if (!hasAccounts) return <Text style={[styles.help, { marginTop: 14 }]}>{summary}</Text>;

  return (
    <View style={[styles.filterBar, { alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }]}>
      <Text style={[styles.help, { marginTop: 0 }]}>{summary}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          accessibilityState={{ disabled: currentPage === 1 }}
          disabled={currentPage === 1}
          onPress={() => onPageChange(currentPage - 1)}
          style={({ pressed }) => [
            styles.secondary,
            currentPage === 1 && styles.disabled,
            pressed && currentPage !== 1 && { opacity: 0.78 },
          ]}
        >
          <Text style={styles.secondaryText}>Previous</Text>
        </Pressable>
        {pageNumbers.map((p) =>
          typeof p === 'string' ? (
            <Text key={p} style={styles.muted}>
              …
            </Text>
          ) : (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityLabel={p === currentPage ? `Current page, page ${p}` : `Go to page ${p}`}
              accessibilityState={{ selected: p === currentPage }}
              onPress={() => onPageChange(p)}
              style={({ pressed }) => [
                styles.secondary,
                {
                  minWidth: 36,
                  alignItems: 'center',
                  backgroundColor: p === currentPage ? colors.primaryAction : colors.surfaceAlt,
                  borderColor: p === currentPage ? colors.primaryAction : colors.inputBorder,
                },
                pressed && p !== currentPage && { opacity: 0.78 },
              ]}
            >
              <Text
                style={[
                  styles.secondaryText,
                  p === currentPage && { color: colors.onPrimary || '#FFFFFF' },
                ]}
              >
                {p}
              </Text>
            </Pressable>
          )
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next page"
          accessibilityState={{ disabled: currentPage === totalPages }}
          disabled={currentPage === totalPages}
          onPress={() => onPageChange(currentPage + 1)}
          style={({ pressed }) => [
            styles.secondary,
            currentPage === totalPages && styles.disabled,
            pressed && currentPage !== totalPages && { opacity: 0.78 },
          ]}
        >
          <Text style={styles.secondaryText}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ManagerAccountsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const isDark = resolvedTheme === 'dark';

  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'requester' | 'distributor'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'suspended'
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  // Moderation modal state
  const [modalTarget, setModalTarget] = useState(null);
  const [selectedReasonCode, setSelectedReasonCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadData = useCallback(async () => {
    setLoadError('');
    try {
      const data = await getManagerWorkspace();
      setWorkspace(data);
    } catch (err) {
      setLoadError(err.message || 'Unable to load branch accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Combine and normalize accounts
  const allAccounts = useMemo(() => {
    if (!workspace) return [];
    const distributors = (workspace.distributors || []).map((d) => ({
      ...d,
      role: 'distributor',
      displayRole: 'Distributor',
    }));
    const requesters = (workspace.requesters || []).map((r) => ({
      ...r,
      role: 'requester',
      displayRole: 'Requester',
    }));
    return [...distributors, ...requesters].sort((a, b) =>
      (a.fullName || '').localeCompare(b.fullName || '')
    );
  }, [workspace]);

  // Tab counts
  const allCount = allAccounts.length;
  const requesterCount = useMemo(
    () => allAccounts.filter((a) => a.role === 'requester').length,
    [allAccounts]
  );
  const distributorCount = useMemo(
    () => allAccounts.filter((a) => a.role === 'distributor').length,
    [allAccounts]
  );

  // Filter accounts by tab, status, and search
  const filteredAccounts = useMemo(() => {
    let list = allAccounts;
    if (activeTab === 'requester') {
      list = list.filter((acc) => acc.role === 'requester');
    } else if (activeTab === 'distributor') {
      list = list.filter((acc) => acc.role === 'distributor');
    }

    if (statusFilter === 'active') {
      list = list.filter((acc) => acc.branchSuspended !== true);
    } else if (statusFilter === 'suspended') {
      list = list.filter((acc) => acc.branchSuspended === true);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((acc) =>
        [
          acc.fullName,
          acc.username,
          acc.publicUid,
          acc.displayUid,
          acc.uniqueId,
          acc.email,
          acc.phone,
          acc.barangay,
          acc.address,
        ]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(q))
      );
    }

    return list;
  }, [allAccounts, activeTab, statusFilter, search]);

  const accountPage = useMemo(
    () => accountPageSlice(filteredAccounts, page),
    [filteredAccounts, page]
  );
  const paginatedAccounts = accountPage.accounts;
  const currentPage = accountPage.currentPage;

  const handleReset = () => {
    setSearch('');
    setStatusFilter('all');
    setPage(1);
  };

  const handleOpenSuspend = (account) => {
    setModalTarget(account);
    setSelectedReasonCode('');
    setModalError('');
  };

  const handleConfirmSuspend = async () => {
    if (!selectedReasonCode) {
      setModalError('Please select a reason for suspending this user from your branch.');
      return;
    }
    setActionLoading(true);
    setModalError('');
    try {
      await suspendManagerBranchUser(modalTarget.uid || modalTarget.id, {
        reasonCode: selectedReasonCode,
      });
      setToast({
        visible: true,
        message: `${modalTarget.fullName || modalTarget.publicUid} suspended from branch.`,
        type: 'success',
      });
      setModalTarget(null);
      await loadData();
    } catch (err) {
      setModalError(err.message || 'Failed to suspend user.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreUser = async (account) => {
    setActionLoading(true);
    try {
      await restoreManagerBranchUser(account.uid || account.id, 'Branch access restored by manager');
      setToast({
        visible: true,
        message: `Branch access restored for ${account.fullName || account.publicUid}.`,
        type: 'success',
      });
      await loadData();
    } catch (err) {
      setToast({
        visible: true,
        message: err.message || 'Failed to restore branch access.',
        type: 'error',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const styles = useMemo(
    () => createStyles(colors, compact, isDark, width),
    [colors, compact, isDark, width]
  );

  return (
    <ManagerShell
      active="accounts"
      title="Branch Accounts"
      subtitle="Manage customer and distributor branch access"
    >
      <View style={styles.container}>
        <TopToastFeedback
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
        />

        {/* Main Accounts Workspace Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Branch Accounts</Text>
          <Text style={styles.help}>
            A compact, authoritative list of Requesters and Distributors associated with your branch.
          </Text>

          {/* Account Type Filters (Pill Tabs) */}
          <View style={styles.tabs}>
            <AccountTab
              active={activeTab === 'all'}
              label="All"
              count={allCount}
              onPress={() => {
                setActiveTab('all');
                setPage(1);
              }}
            />
            <AccountTab
              active={activeTab === 'requester'}
              label="Requesters"
              count={requesterCount}
              onPress={() => {
                setActiveTab('requester');
                setPage(1);
              }}
            />
            <AccountTab
              active={activeTab === 'distributor'}
              label="Distributors"
              count={distributorCount}
              onPress={() => {
                setActiveTab('distributor');
                setPage(1);
              }}
            />
          </View>

          {/* Filter Bar (Search + Status + Reset) */}
          <View style={styles.filterBar}>
            <View style={styles.search}>
              <TextInput
                value={search}
                onChangeText={(val) => {
                  setSearch(val);
                  setPage(1);
                }}
                placeholder="Search name, username, Public UID, email, phone, or barangay"
                placeholderTextColor={colors.placeholder || colors.textSecondary}
                autoCapitalize="none"
                style={styles.input}
              />
            </View>

            <View style={styles.filter}>
              <Text style={styles.filterLabel}>Status</Text>
              <SelectControl
                accessibilityLabel="Filter by status"
                value={statusFilter}
                options={['all', 'active', 'suspended']}
                labelFor={(val) =>
                  val === 'all' ? 'All statuses' : val === 'active' ? 'Active' : 'Suspended'
                }
                onSelect={(val) => {
                  setStatusFilter(val);
                  setPage(1);
                }}
              />
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              onPress={handleReset}
              style={styles.reset}
            >
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Account List Area */}
          {loading ? (
            <TableSkeleton rows={6} />
          ) : loadError ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{loadError}</Text>
              <TouchableOpacity onPress={loadData} style={{ marginTop: 8 }}>
                <Text style={styles.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filteredAccounts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <BlueTapEmptyState
                compact
                variant="people"
                title={
                  activeTab === 'distributor'
                    ? 'No Registered Distributors'
                    : activeTab === 'requester'
                      ? 'No Requesters Found'
                      : 'No Accounts Found'
                }
                description={
                  search || statusFilter !== 'all'
                    ? 'No branch accounts match your filter criteria.'
                    : activeTab === 'distributor'
                      ? 'No registered Distributors found for this branch.'
                      : 'No active accounts currently associated with your branch.'
                }
                themeColors={colors}
                dark={isDark}
              />
            </View>
          ) : compact ? (
            /* Mobile Card List */
            <View style={styles.mobileList}>
              {paginatedAccounts.map((account) => {
                const publicId =
                  account.publicUid || account.displayUid || account.uniqueId || '—';
                const isSuspended = account.branchSuspended === true;

                return (
                  <View key={account.uid || account.id} style={styles.mobileCard}>
                    <View style={styles.mobileTop}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.mobileName} numberOfLines={1}>
                          {account.fullName || 'Unnamed Account'}
                        </Text>
                        {account.username ? (
                          <Text style={styles.muted} numberOfLines={1}>
                            @{account.username}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.mobileBadgeRow}>
                        <RoleBadge
                          colors={colors}
                          label={account.displayRole || titleCase(account.role)}
                          role={account.role}
                        />
                        <StatusBadge isSuspended={isSuspended} />
                      </View>
                    </View>

                    <View style={styles.mobileDetails}>
                      <View style={styles.mobileRow}>
                        <Text style={styles.mobileMetaLabel}>Public UID</Text>
                        <Text style={styles.mono}>{publicId}</Text>
                      </View>
                      <View style={styles.mobileRow}>
                        <Text style={styles.mobileMetaLabel}>Contact</Text>
                        <Text style={styles.mobileMetaValue} numberOfLines={1}>
                          {account.phone || '—'}
                        </Text>
                      </View>
                      <View style={styles.mobileRow}>
                        <Text style={styles.mobileMetaLabel}>Email</Text>
                        <Text style={styles.mobileMetaValue} numberOfLines={1}>
                          {account.email || '—'}
                        </Text>
                      </View>
                      <View style={styles.mobileRow}>
                        <Text style={styles.mobileMetaLabel}>Location</Text>
                        <Text style={styles.mobileMetaValue} numberOfLines={1}>
                          {account.barangay || account.address || '—'}
                        </Text>
                      </View>
                      <View style={styles.mobileRow}>
                        <Text style={styles.mobileMetaLabel}>Joined</Text>
                        <Text style={styles.mobileMetaValue}>
                          {formatJoinedDate(account.createdAt)}
                        </Text>
                      </View>
                      {isSuspended && !!account.branchSuspensionReason ? (
                        <View style={styles.suspensionReasonBox}>
                          <Text style={styles.suspensionReasonLabel}>Suspension Reason:</Text>
                          <Text style={styles.suspensionReasonText}>
                            {account.branchSuspensionReason}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.mobileActions}>
                      {isSuspended ? (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Restore branch access for ${account.fullName || publicId}`}
                          disabled={actionLoading}
                          onPress={() => handleRestoreUser(account)}
                          style={styles.restoreBtn}
                        >
                          <Text style={styles.restoreBtnText}>Restore branch access</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Suspend ${account.fullName || publicId} from branch`}
                          disabled={actionLoading}
                          onPress={() => handleOpenSuspend(account)}
                          style={styles.suspendBtn}
                        >
                          <Text style={styles.suspendBtnText}>Suspend from branch</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            /* Desktop Table View */
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.cell, styles.colName, styles.headerText]}>NAME</Text>
                  <Text style={[styles.cell, styles.colUid, styles.headerText]}>PUBLIC UID</Text>
                  <Text style={[styles.cell, styles.colContact, styles.headerText]}>CONTACT</Text>
                  <Text style={[styles.cell, styles.colEmailLocation, styles.headerText]}>
                    EMAIL / LOCATION
                  </Text>
                  <Text style={[styles.cell, styles.colRole, styles.headerText]}>ROLE</Text>
                  <Text style={[styles.cell, styles.colStatus, styles.headerText]}>STATUS</Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.colActions,
                      styles.headerText,
                      { textAlign: 'right' },
                    ]}
                  >
                    ACTIONS
                  </Text>
                </View>

                {paginatedAccounts.map((account, idx) => {
                  const publicId =
                    account.publicUid || account.displayUid || account.uniqueId || '—';
                  const isSuspended = account.branchSuspended === true;

                  return (
                    <View
                      key={account.uid || account.id}
                      style={[
                        styles.tableRow,
                        idx % 2 === 1 && { backgroundColor: colors.surfaceAlt },
                      ]}
                    >
                      <View style={[styles.cell, styles.colName]}>
                        <Text style={styles.strong} numberOfLines={1}>
                          {account.fullName || 'Unnamed Account'}
                        </Text>
                        {account.username ? (
                          <Text style={styles.muted} numberOfLines={1}>
                            @{account.username}
                          </Text>
                        ) : null}
                      </View>

                      <View style={[styles.cell, styles.colUid]}>
                        <Text style={styles.mono}>{publicId}</Text>
                      </View>

                      <View style={[styles.cell, styles.colContact]}>
                        <Text style={styles.cellText} numberOfLines={1}>
                          {account.phone || '—'}
                        </Text>
                      </View>

                      <View style={[styles.cell, styles.colEmailLocation]}>
                        <Text style={styles.cellText} numberOfLines={1}>
                          {account.email || '—'}
                        </Text>
                        <Text style={styles.muted} numberOfLines={1}>
                          {account.barangay || account.address || '—'}
                        </Text>
                      </View>

                      <View style={[styles.cell, styles.colRole]}>
                        <RoleBadge
                          colors={colors}
                          label={account.displayRole || titleCase(account.role)}
                          role={account.role}
                        />
                      </View>

                      <View style={[styles.cell, styles.colStatus]}>
                        <StatusBadge isSuspended={isSuspended} />
                        {isSuspended && !!account.branchSuspensionReason ? (
                          <Text style={styles.suspensionReasonSummary} numberOfLines={1}>
                            {account.branchSuspensionReason}
                          </Text>
                        ) : null}
                      </View>

                      <View style={[styles.cell, styles.colActions]}>
                        {isSuspended ? (
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Restore branch access for ${account.fullName || publicId}`}
                            disabled={actionLoading}
                            onPress={() => handleRestoreUser(account)}
                            style={styles.tableRestoreBtn}
                          >
                            <Text style={styles.tableRestoreBtnText}>Restore</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Suspend ${account.fullName || publicId} from branch`}
                            disabled={actionLoading}
                            onPress={() => handleOpenSuspend(account)}
                            style={styles.tableSuspendBtn}
                          >
                            <Text style={styles.tableSuspendBtnText}>Suspend</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* Pagination */}
          {!loading && filteredAccounts.length > 0 ? (
            <AccountPagination
              currentPage={currentPage}
              onPageChange={setPage}
              totalAccounts={filteredAccounts.length}
            />
          ) : null}
        </View>

        {/* Viewport-Safe Suspension Confirmation Modal */}
        <Modal
          visible={Boolean(modalTarget)}
          transparent
          animationType="fade"
          onRequestClose={() => !actionLoading && setModalTarget(null)}
        >
          <View style={styles.modalBackdrop}>
            <View
              accessibilityViewIsModal
              style={[
                styles.modalCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {/* Stable Fixed Header */}
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <View style={styles.warningIconWrap}>
                  <AdminIcon name="security" size={24} color={colors.danger} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.modalTitle} numberOfLines={1}>
                    Suspend from branch?
                  </Text>
                  <Text style={styles.modalSub} numberOfLines={1}>
                    Account: <Text style={styles.modalSubStrong}>{modalTarget?.fullName || modalTarget?.publicUid}</Text>
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close dialog"
                  disabled={actionLoading}
                  onPress={() => setModalTarget(null)}
                  style={styles.close}
                >
                  <Text style={styles.closeText}>×</Text>
                </TouchableOpacity>
              </View>

              {/* Scrollable Body - flex: 1, flexShrink: 1 */}
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
              >
                <Text style={styles.modalDescription}>
                  Suspend{' '}
                  <Text style={{ fontWeight: '800', color: colors.textPrimary }}>
                    {modalTarget?.fullName || modalTarget?.publicUid}
                  </Text>{' '}
                  ({modalTarget?.publicUid || modalTarget?.displayUid || '—'}) from your branch operations.
                  {modalTarget?.role === 'requester'
                    ? ' This blocks the user from placing new orders and chatting with this branch. General platform access remains active.'
                    : ' This disables the distributor from active dispatching and deliveries for this branch.'}
                </Text>

                <View style={styles.modalInputSection}>
                  <Text style={styles.modalInputLabel}>Reason for suspension *</Text>
                  <View style={styles.reasonsList}>
                    {BRANCH_SUSPENSION_REASONS.map((item) => {
                      const isSelected = selectedReasonCode === item.reasonCode;
                      return (
                        <TouchableOpacity
                          key={item.reasonCode}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: isSelected }}
                          accessibilityLabel={item.reasonLabel}
                          onPress={() => setSelectedReasonCode(item.reasonCode)}
                          style={[
                            styles.reasonOption,
                            isSelected && styles.reasonOptionSelected,
                          ]}
                        >
                          <View
                            style={[
                              styles.radioCircle,
                              isSelected && styles.radioCircleSelected,
                            ]}
                          >
                            {isSelected && <View style={styles.radioDot} />}
                          </View>
                          <Text
                            style={[
                              styles.reasonLabelText,
                              isSelected && styles.reasonLabelTextSelected,
                            ]}
                          >
                            {item.reasonLabel}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {!!modalError && <Text style={styles.modalErrorText}>{modalError}</Text>}
              </ScrollView>

              {/* Fixed, Always Reachable Responsive Footer */}
              <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Cancel suspension"
                  disabled={actionLoading}
                  onPress={() => setModalTarget(null)}
                  style={styles.modalCancelBtn}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Confirm suspension"
                  disabled={actionLoading || !selectedReasonCode}
                  onPress={handleConfirmSuspend}
                  style={[
                    styles.modalConfirmBtn,
                    !selectedReasonCode ? styles.modalConfirmBtnDisabled : styles.modalConfirmBtnEnabled,
                    actionLoading && styles.disabled,
                  ]}
                >
                  {actionLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.modalConfirmBtnText,
                        !selectedReasonCode && styles.modalConfirmBtnTextDisabled,
                      ]}
                    >
                      Confirm Suspension
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ManagerShell>
  );
}

const createStyles = (colors, compact = false, isDark = false, width = 1024) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: compact ? 14 : 24,
      maxWidth: 1280,
      alignSelf: 'center',
      width: '100%',
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BLUETAP_LAYOUT.radius.lg,
      padding: compact ? 16 : 20,
      marginBottom: 18,
      ...BLUETAP_LAYOUT.shadow,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    help: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 5,
    },
    tabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 14,
      marginBottom: 12,
    },
    tab: {
      minHeight: 38,
      paddingHorizontal: 16,
      borderRadius: 999,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
    },
    tabActive: {
      backgroundColor: colors.primaryAction || '#0B67AD',
      borderColor: colors.primaryAction || '#0B67AD',
    },
    tabInactive: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.inputBorder || colors.border,
    },
    tabText: {
      fontSize: 12,
      fontWeight: '900',
    },
    tabTextActive: {
      color: '#FFFFFF',
    },
    tabTextInactive: {
      color: colors.textPrimary,
    },
    tabCount: {
      fontSize: 12,
      fontWeight: '800',
    },
    tabCountActive: {
      color: '#FFFFFF',
    },
    tabCountInactive: {
      color: colors.textSecondary,
    },
    filterBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      alignItems: 'flex-end',
      marginTop: 10,
      marginBottom: 16,
    },
    search: {
      minWidth: 250,
      flexGrow: 1,
      flexBasis: 280,
    },
    filter: {
      minWidth: 140,
      flexGrow: 1,
      flexBasis: 160,
    },
    filterLabel: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '900',
      marginBottom: 5,
    },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: colors.textPrimary,
      fontSize: 13,
      outlineStyle: 'none',
    },
    select: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    selectText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      flex: 1,
    },
    chevron: {
      color: colors.primary,
      fontSize: 19,
      fontWeight: '900',
      marginLeft: 8,
    },
    selectBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    selectMenu: {
      width: '100%',
      maxWidth: 320,
      borderWidth: 1,
      borderRadius: 12,
      overflow: 'hidden',
    },
    selectList: {
      maxHeight: 220,
    },
    selectOption: {
      minHeight: 46,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    selectOptionText: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 13,
    },
    optionCheck: {
      color: colors.primary,
      fontWeight: '900',
    },
    reset: {
      minHeight: 44,
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    resetText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '900',
    },
    secondary: {
      minHeight: 36,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    secondaryText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '900',
    },
    disabled: {
      opacity: 0.72,
    },
    notice: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
    },
    noticeText: {
      color: colors.danger,
      fontWeight: '700',
    },
    retry: {
      color: colors.primary,
      fontWeight: '900',
    },
    emptyContainer: {
      paddingVertical: 24,
    },
    // Desktop Table Styles
    tableScroll: {
      minWidth: '100%',
    },
    table: {
      minWidth: 960,
      marginTop: 14,
    },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 60,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableHeader: {
      minHeight: 44,
      backgroundColor: colors.surfaceAlt,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    cell: {
      paddingHorizontal: 8,
      color: colors.textSecondary,
      fontSize: 12,
      justifyContent: 'center',
    },
    headerText: {
      color: colors.textPrimary,
      fontWeight: '900',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    strong: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 13,
    },
    muted: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    mono: {
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    cellText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    colName: {
      width: 180,
      flexGrow: 1,
    },
    colUid: {
      width: 130,
    },
    colContact: {
      width: 130,
    },
    colEmailLocation: {
      width: 220,
      flexGrow: 1,
    },
    colRole: {
      width: 110,
    },
    colStatus: {
      width: 110,
    },
    colActions: {
      width: 120,
      alignItems: 'flex-end',
    },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
    },
    badgeGreen: {
      color: colors.success,
      backgroundColor: colors.successSoft,
    },
    badgeRed: {
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    badgeAmber: {
      color: colors.warning,
      backgroundColor: colors.warningSoft,
    },
    suspensionReasonSummary: {
      fontSize: 10,
      color: colors.danger,
      marginTop: 3,
    },
    tableSuspendBtn: {
      minHeight: 38,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: 8,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tableSuspendBtnText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '900',
    },
    tableRestoreBtn: {
      minHeight: 38,
      borderWidth: 1,
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
      borderRadius: 8,
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tableRestoreBtnText: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '900',
    },
    // Mobile Card Styles
    mobileList: {
      gap: 12,
      marginTop: 16,
    },
    mobileCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
      backgroundColor: colors.surfaceAlt,
    },
    mobileTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    mobileName: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    mobileBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    mobileDetails: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      marginTop: 10,
      gap: 6,
    },
    mobileRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    mobileMetaLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    mobileMetaValue: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
      textAlign: 'right',
      flexShrink: 1,
    },
    suspensionReasonBox: {
      marginTop: 6,
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
      borderWidth: 1,
    },
    suspensionReasonLabel: {
      fontSize: 10,
      color: colors.danger,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    suspensionReasonText: {
      fontSize: 12,
      color: colors.textPrimary,
      marginTop: 2,
    },
    mobileActions: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      marginTop: 6,
    },
    suspendBtn: {
      minHeight: 44,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    suspendBtnText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '900',
    },
    restoreBtn: {
      minHeight: 44,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    restoreBtnText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '900',
    },
    // Viewport-Safe Modal Styles
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 500,
      maxHeight: '90%',
      display: 'flex',
      flexDirection: 'column',
      borderWidth: 1,
      borderRadius: 18,
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      flexShrink: 0,
    },
    warningIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: colors.dangerSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    modalSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    modalSubStrong: {
      color: colors.textPrimary,
      fontWeight: '900',
    },
    close: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textPrimary,
      fontSize: 24,
      lineHeight: 26,
    },
    modalScroll: {
      flex: 1,
      flexShrink: 1,
      flexGrow: 1,
    },
    modalScrollContent: {
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    modalDescription: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginBottom: 14,
    },
    modalInputSection: {
      marginBottom: 14,
    },
    modalInputLabel: {
      fontSize: 12,
      fontWeight: '900',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    reasonsList: {
      gap: 8,
      marginTop: 4,
    },
    reasonOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      backgroundColor: colors.surfaceAlt,
      minHeight: 44,
    },
    reasonOptionSelected: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    radioCircle: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    radioCircleSelected: {
      borderColor: colors.danger,
    },
    radioDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.danger,
    },
    reasonLabelText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
    },
    reasonLabelTextSelected: {
      fontWeight: '800',
      color: colors.danger,
    },
    modalErrorText: {
      fontSize: 12,
      color: colors.danger,
      fontWeight: '700',
      marginBottom: 12,
    },
    modalFooter: {
      flexDirection: width < 440 ? 'column-reverse' : 'row',
      justifyContent: width < 440 ? 'center' : 'flex-end',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderTopWidth: 1,
      flexShrink: 0,
      width: '100%',
    },
    modalCancelBtn: {
      minHeight: 44,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
      width: width < 440 ? '100%' : undefined,
    },
    modalCancelBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    modalConfirmBtn: {
      minHeight: 44,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
      minWidth: width < 440 ? '100%' : 150,
      width: width < 440 ? '100%' : undefined,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalConfirmBtnEnabled: {
      backgroundColor: '#DC2626',
      borderWidth: 1,
      borderColor: '#DC2626',
    },
    modalConfirmBtnDisabled: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(220, 38, 38, 0.12)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(239, 68, 68, 0.35)' : 'rgba(220, 38, 38, 0.3)',
    },
    modalConfirmBtnText: {
      fontSize: 13,
      fontWeight: '900',
      color: '#FFFFFF',
    },
    modalConfirmBtnTextDisabled: {
      color: isDark ? '#F87171' : '#B91C1C',
    },
  });
