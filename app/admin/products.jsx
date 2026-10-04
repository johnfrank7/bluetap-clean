import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import AdminShell from '../../components/AdminShell';
import { CardSkeleton } from '../../components/AdminSkeleton';
import { StatusBadge } from '../../components/DashboardUi';
import { useAdminTheme } from '../../components/AdminTheme';
import { BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import {
  adminProductErrorMessage,
  createAdminProduct,
  getAdminProducts,
  updateAdminProduct,
} from '../../services/adminProducts';
import { getBranches } from '../../services/branchManagement';
import TopToastFeedback from '../../components/TopToastFeedback';
const { WEEKDAYS } = require('../../services/productOrderPolicy');

const empty = {
  product_name: '',
  description: '',
  price: '',
  containerType: '',
  size: '',
  maxQuantityPerRequester: '',
  deliveryDays: [],
  active: true,
  branchIds: [],
  image: '',
  imagePath: '',
  imageFile: null,
  imagePreview: '',
};

const money = (value) => `₱${Number(value || 0).toFixed(2)}`;
const PAGE_SIZE = 9;

function ProductToolbarWebStyles({ colors }) {
  if (Platform.OS !== 'web') return null;

  const primary = colors.primaryAction;
  const primaryStrong = colors.primaryDeep || colors.primaryAction;

  return React.createElement('style', {
    dangerouslySetInnerHTML: {
      __html: `
        button#admin-products-add-action,
        button[data-admin-products-filter-selected="true"] {
          background-color: ${primary};
          border-color: ${primary};
        }
        button#admin-products-add-action:hover,
        button#admin-products-add-action:active,
        button[data-admin-products-filter-selected="true"]:hover,
        button[data-admin-products-filter-selected="true"]:active {
          background-color: ${primaryStrong};
          border-color: ${primaryStrong};
        }
        button[data-admin-products-filter-selected="false"]:hover {
          background-color: ${colors.primarySoft};
          border-color: ${colors.primary};
        }
      `,
    },
  });
}

function ProductPolicyFields({ form, setForm, toggleDay, styles }) {
  return (
    <View style={styles.policySection}>
      <Text style={styles.policyEyebrow}>DELIVERY &amp; ORDER POLICY</Text>
      <Text style={styles.policyHelp}>
        These are the Admin defaults. Authorized Manager branch overrides may replace these values for their own branch.
      </Text>

      <Text style={styles.label}>Requester Order Limit</Text>
      <TextInput
        accessibilityLabel="Requester Order Limit"
        value={form.maxQuantityPerRequester}
        keyboardType="number-pad"
        placeholder="Optional (1-100)"
        onChangeText={(value) =>
          setForm((current) => ({ ...current, maxQuantityPerRequester: value }))
        }
        style={styles.input}
      />
      <Text style={styles.help}>
        Orders above this quantity require Manager approval. Leave blank for no limit.
      </Text>

      <Text style={[styles.label, { marginTop: 16 }]}>Delivery Days</Text>
      <Text style={styles.help}>Leave all days unselected for daily delivery.</Text>
      <View style={styles.branchChoices}>
        {WEEKDAYS.map((day) => {
          const checked = form.deliveryDays.includes(day);
          return (
            <TouchableOpacity
              key={day}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => toggleDay(day)}
              style={[styles.choice, checked && styles.choiceActive]}
            >
              <Text style={[styles.choiceText, checked && styles.choiceTextActive]}>
                {day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function AdminProductsPage() {
  const { colors } = useAdminTheme();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const isMobile = width < 540;
  const styles = React.useMemo(() => createStyles(colors, compact, isMobile), [colors, compact, isMobile]);

  const productsState = useAdminData(ADMIN_CACHE_KEYS.products, getAdminProducts);
  const branchesState = useAdminData(ADMIN_CACHE_KEYS.branches, getBranches);
  const products = productsState.data || [];
  const branches = branchesState.data || [];

  const branchMap = React.useMemo(
    () => new Map(branches.map((b) => [b.id, b.name])),
    [branches]
  );

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [modal, setModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState(empty);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [toast, setToast] = React.useState({ visible: false, message: '', type: 'info' });

  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });

  const summaryMetrics = React.useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.active !== false).length;
    const inactive = products.filter((p) => p.active === false).length;
    const branchRestricted = products.filter(
      (p) => Array.isArray(p.branchIds) && p.branchIds.length > 0
    ).length;
    return [
      { label: 'Total Products', value: total },
      { label: 'Active', value: active },
      { label: 'Inactive', value: inactive },
      { label: 'Branch Restricted', value: branchRestricted },
    ];
  }, [products]);

  React.useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch =
        !query ||
        [
          product.product_name,
          product.containerType,
          product.size,
          product.description,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && product.active !== false) ||
        (statusFilter === 'inactive' && product.active === false);

      return matchesSearch && matchesStatus;
    });
  }, [products, search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const pagedProducts = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const open = (product = null) => {
    setEditing(product);
    setForm(
      product
        ? {
            ...empty,
            ...product,
            price: String(product.price),
            maxQuantityPerRequester:
              product.maxQuantityPerRequester == null
                ? ''
                : String(product.maxQuantityPerRequester),
            imagePreview: product.imageUrl || product.image || '',
          }
        : empty
    );
    setMessage('');
    setModal(true);
  };

  const close = () => {
    if (!saving) {
      setModal(false);
      setEditing(null);
      setForm(empty);
    }
  };

  const chooseImage = () => {
    if (!globalThis.document) {
      const imageMessage = 'Image upload is currently available in the web Admin portal.';
      setMessage(imageMessage);
      showToast(imageMessage, 'warning');
      return;
    }
    const input = globalThis.document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const preview = globalThis.URL?.createObjectURL?.(file) || '';
      setForm((current) => ({
        ...current,
        imageFile: file,
        imagePreview: preview,
      }));
    };
    input.click();
  };

  const toggleBranch = (id) =>
    setForm((current) => ({
      ...current,
      branchIds: current.branchIds.includes(id)
        ? current.branchIds.filter((item) => item !== id)
        : [...current.branchIds, id],
    }));

  const toggleDay = (day) =>
    setForm((current) => ({
      ...current,
      deliveryDays: current.deliveryDays.includes(day)
        ? current.deliveryDays.filter((item) => item !== day)
        : [...current.deliveryDays, day],
    }));

  const save = async () => {
    const price = Number(form.price);
    if (!form.product_name.trim() || !Number.isFinite(price) || price < 0) {
      setMessage('Enter a product name and valid price.');
      showToast('Enter a product name and valid price.', 'error');
      return;
    }
    const limit =
      form.maxQuantityPerRequester === ''
        ? null
        : Number(form.maxQuantityPerRequester);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      setMessage('Requester order limit must be a whole number from 1 to 100.');
      showToast('Requester order limit must be a whole number from 1 to 100.', 'error');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        product_name: form.product_name.trim(),
        description: form.description.trim(),
        price,
        containerType: form.containerType.trim(),
        size: form.size.trim(),
        maxQuantityPerRequester: limit,
        deliveryDays: form.deliveryDays,
        active: form.active,
        branchIds: form.branchIds,
      };
      if (editing) await updateAdminProduct(editing.id, payload, form.imageFile);
      else await createAdminProduct(payload, form.imageFile);
      setModal(false);
      setEditing(null);
      setForm(empty);
      await productsState.refresh({ force: true });
      setMessage('Product saved. Requesters will see the updated catalog on refresh.');
      showToast('Product saved successfully.', 'success');
    } catch (error) {
      const err = adminProductErrorMessage(error);
      setMessage(err);
      showToast(err, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product) => {
    setSaving(true);
    setMessage('');
    try {
      await updateAdminProduct(product.id, { active: !product.active }, null);
      await productsState.refresh({ force: true });
      const toggleMsg = product.active ? 'Product deactivated.' : 'Product activated.';
      setMessage(toggleMsg);
      showToast(toggleMsg, 'success');
    } catch (error) {
      const err = adminProductErrorMessage(error);
      setMessage(err);
      showToast(err, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Products"
      subtitle="Manage the authoritative product catalog, pricing, images, and availability."
    >
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
      <ProductToolbarWebStyles colors={colors} />

      {/* SUMMARY METRICS ROW */}
      <View style={styles.metricsRow}>
        {summaryMetrics.map((metric) => (
          <View key={metric.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value}</Text>
          </View>
        ))}
      </View>

      {/* TOOLBAR */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarInfo}>
          <Text style={styles.eyebrow}>PRODUCT CATALOG</Text>
          <Text style={styles.heading}>
            Products and pricing ({filtered.length})
          </Text>
        </View>

        <View style={styles.toolbarControls}>
          <TextInput
            accessibilityLabel="Search products"
            value={search}
            onChangeText={setSearch}
            placeholder="Search products…"
            placeholderTextColor={colors.placeholder || colors.textSecondary}
            style={styles.search}
          />

          <View style={styles.statusPills}>
            {[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'inactive', label: 'Inactive' },
            ].map((item) => (
              <Pressable
                key={item.id}
                dataSet={{
                  adminProductsFilterSelected:
                    statusFilter === item.id ? 'true' : 'false',
                }}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${item.label} products`}
                accessibilityState={{ selected: statusFilter === item.id }}
                onPress={() => setStatusFilter(item.id)}
                style={({ hovered, focused, pressed }) => [
                  styles.statusPill,
                  statusFilter === item.id && styles.statusPillActive,
                  hovered &&
                    (statusFilter === item.id
                      ? styles.statusPillActiveHover
                      : styles.statusPillHover),
                  pressed && styles.toolbarControlPressed,
                  focused && styles.toolbarControlFocus,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    statusFilter === item.id && styles.statusPillTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            nativeID="admin-products-add-action"
            accessibilityRole="button"
            accessibilityLabel="Add product"
            onPress={() => open()}
            style={({ hovered, focused, pressed }) => [
              styles.primary,
              hovered && styles.primaryHover,
              pressed && styles.primaryPressed,
              focused && styles.toolbarControlFocus,
            ]}
          >
            <Text style={styles.primaryText}>Add product</Text>
          </Pressable>
        </View>
      </View>

      {!!message && (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={styles.noticeText}>{message}</Text>
        </View>
      )}

      {productsState.loading && !productsState.data ? (
        <View style={styles.grid}>
          {[1, 2, 3].map((key) => (
            <CardSkeleton key={key} style={styles.skeleton} />
          ))}
        </View>
      ) : productsState.error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Unable to load products</Text>
          <TouchableOpacity onPress={() => productsState.refresh({ force: true })}>
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No products found</Text>
          <Text style={styles.emptyText}>
            {search || statusFilter !== 'all'
              ? 'Try adjusting your search or status filter.'
              : 'Add the first BlueTap product to publish it to Requesters.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            {pagedProducts.map((product) => {
              const days = product.deliveryDays || [];
              const hasDayRestrictions =
                Array.isArray(days) && days.length > 0 && days.length < 7;
              const hasBranchRestrictions =
                Array.isArray(product.branchIds) && product.branchIds.length > 0;

              return (
                <View key={product.id} style={styles.card}>
                  {/* TOP AREA */}
                  <View style={styles.cardTop}>
                    <View style={styles.imageSurface}>
                      {product.image || product.imageUrl ? (
                        <Image
                          source={{ uri: product.image || product.imageUrl }}
                          style={styles.image}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                          transition={120}
                        />
                      ) : (
                        <Text style={styles.placeholder}>◈</Text>
                      )}
                    </View>

                    <View style={styles.productCopy}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={2}>
                          {product.product_name}
                        </Text>
                        <StatusBadge
                          status={product.active !== false ? 'active' : 'inactive'}
                        />
                      </View>
                      <Text style={styles.price}>{money(product.price)}</Text>
                      <Text style={styles.detail}>
                        {[product.containerType, product.size]
                          .filter(Boolean)
                          .join(' · ') || 'Container details not set'}
                      </Text>
                    </View>
                  </View>

                  {/* POLICY / AVAILABILITY AREA */}
                  <View style={styles.policyArea}>
                    <View style={styles.policyRow}>
                      <Text style={styles.policyLabel}>BRANCH AVAILABILITY</Text>
                      {hasBranchRestrictions ? (
                        <View style={styles.tagContainer}>
                          {product.branchIds.map((branchId) => (
                            <View key={branchId} style={styles.branchTag}>
                              <Text style={styles.branchTagText}>
                                {branchMap.get(branchId) || 'Branch'}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.policyValue}>
                          Available at all active branches
                        </Text>
                      )}
                    </View>

                    <View style={styles.policyRow}>
                      <Text style={styles.policyLabel}>DELIVERY AVAILABILITY</Text>
                      {hasDayRestrictions ? (
                        <View style={styles.tagContainer}>
                          {days.map((day) => (
                            <View key={day} style={styles.dayChip}>
                              <Text style={styles.dayChipText}>
                                {day.slice(0, 3).toUpperCase()}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.policyValue}>Daily delivery</Text>
                      )}
                    </View>

                    <View style={styles.policyRow}>
                      <Text style={styles.policyLabel}>REQUESTER ORDER LIMIT</Text>
                      <Text style={styles.policyValue}>
                        {product.maxQuantityPerRequester != null &&
                        product.maxQuantityPerRequester !== ''
                          ? `${product.maxQuantityPerRequester} per request`
                          : 'No limit'}
                      </Text>
                    </View>
                  </View>

                  {/* BOTTOM ACTION AREA */}
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${product.product_name}`}
                      onPress={() => open(product)}
                      style={styles.editAction}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.editActionText}>Edit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`${product.active !== false ? 'Deactivate' : 'Activate'} ${product.product_name}`}
                      disabled={saving}
                      onPress={() => toggleActive(product)}
                      style={[
                        styles.statusAction,
                        product.active !== false
                          ? styles.deactivateAction
                          : styles.activateAction,
                        saving && styles.disabledAction,
                      ]}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.statusActionText,
                          product.active !== false
                            ? styles.deactivateActionText
                            : styles.activateActionText,
                        ]}
                      >
                        {product.active !== false ? 'Deactivate' : 'Activate'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* PAGINATION (Only if totalPages > 1) */}
          {totalPages > 1 && (
            <View style={styles.pagination}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Previous page"
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              >
                <Text
                  style={[
                    styles.pageBtnText,
                    page <= 1 && styles.pageBtnTextDisabled,
                  ]}
                >
                  Previous
                </Text>
              </TouchableOpacity>

              <Text style={styles.pageInfo}>
                Page {page} of {totalPages}
              </Text>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Next page"
                disabled={page >= totalPages}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
              >
                <Text
                  style={[
                    styles.pageBtnText,
                    page >= totalPages && styles.pageBtnTextDisabled,
                  ]}
                >
                  Next
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* MODAL */}
      <Modal visible={modal} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>
                {editing ? 'Edit product' : 'Add product'}
              </Text>

              {/* PRODUCT INFORMATION */}
              <View style={styles.policySection}>
                <Text style={styles.policyEyebrow}>PRODUCT INFORMATION</Text>
                <Text style={styles.policyHelp}>
                  Define the authoritative product identity, price, image, availability, and status.
                </Text>

                <View style={styles.formGrid}>
                  {[
                    ['product_name', 'Product name'],
                    ['price', 'Price'],
                    ['containerType', 'Container type'],
                    ['size', 'Size'],
                  ].map(([key, label]) => (
                    <View key={key} style={styles.field}>
                      <Text style={styles.label}>{label}</Text>
                      <TextInput
                        accessibilityLabel={label}
                        value={form[key]}
                        keyboardType={key === 'price' ? 'decimal-pad' : 'default'}
                        onChangeText={(value) =>
                          setForm((current) => ({ ...current, [key]: value }))
                        }
                        style={styles.input}
                      />
                    </View>
                  ))}
                </View>

                <Text style={styles.label}>Description</Text>
                <TextInput
                  accessibilityLabel="Description"
                  multiline
                  value={form.description}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, description: value }))
                  }
                  style={[styles.input, styles.multiline]}
                />

                <Text style={styles.label}>Product image</Text>
                <View style={styles.uploadRow}>
                  {form.imagePreview ? (
                    <Image
                      source={{ uri: form.imagePreview }}
                      style={styles.preview}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      transition={120}
                    />
                  ) : (
                    <View style={styles.preview}>
                      <Text style={styles.placeholder}>No image</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Choose image"
                    onPress={chooseImage}
                    style={styles.uploadBtn}
                  >
                    <Text style={styles.uploadBtnText}>Choose image</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Branch availability</Text>
                <Text style={styles.help}>
                  Leave every branch unselected to make this product available at all active branches.
                </Text>
                <View style={styles.branchChoices}>
                  {branches.map((branch) => {
                    const checked = form.branchIds.includes(branch.id);
                    return (
                      <TouchableOpacity
                        key={branch.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        onPress={() => toggleBranch(branch.id)}
                        style={[styles.choice, checked && styles.choiceActive]}
                      >
                        <Text
                          style={[
                            styles.choiceText,
                            checked && styles.choiceTextActive,
                          ]}
                        >
                          {branch.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>Active status</Text>
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: form.active }}
                  onPress={() =>
                    setForm((current) => ({ ...current, active: !current.active }))
                  }
                  style={[styles.choice, form.active && styles.choiceActive]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      form.active && styles.choiceTextActive,
                    ]}
                  >
                    {form.active ? 'Active' : 'Inactive'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* DELIVERY & ORDER POLICY */}
              <ProductPolicyFields
                form={form}
                setForm={setForm}
                toggleDay={toggleDay}
                styles={styles}
              />

              {/* MODAL ACTIONS */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  onPress={close}
                  style={styles.modalCancelBtn}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Save product"
                  disabled={saving}
                  onPress={save}
                  style={[styles.primary, saving && styles.disabledAction]}
                >
                  <Text style={styles.primaryText}>
                    {saving ? 'Saving…' : 'Save product'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </AdminShell>
  );
}

const createStyles = (colors, compact, isMobile) =>
  StyleSheet.create({
    metricsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 18,
      marginBottom: 6,
    },
    metricCard: {
      flexGrow: 1,
      flexBasis: compact ? 130 : 160,
      minWidth: compact ? 0 : 140,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
      ...BLUETAP_LAYOUT.shadow,
    },
    metricLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    metricValue: {
      color: colors.textPrimary,
      fontSize: 22,
      fontWeight: '900',
      marginTop: 4,
    },
    toolbar: {
      marginTop: 14,
      marginBottom: 18,
      flexDirection: compact ? 'column' : 'row',
      alignItems: compact ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: 14,
    },
    toolbarInfo: {
      minWidth: 0,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    heading: {
      color: colors.textPrimary,
      fontSize: 19,
      fontWeight: '900',
      marginTop: 4,
    },
    toolbarControls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
    },
    search: {
      flexGrow: 1,
      minWidth: compact ? 0 : 200,
      minHeight: 42,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.input,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: colors.textPrimary,
      outlineStyle: 'none',
    },
    statusPills: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 3,
      gap: 2,
    },
    statusPill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    statusPillActive: {
      backgroundColor: colors.primaryAction,
      borderColor: colors.primaryAction,
    },
    statusPillHover: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    statusPillActiveHover: {
      backgroundColor: colors.primaryDeep || colors.primaryAction,
      borderColor: colors.primaryDeep || colors.primaryAction,
    },
    statusPillText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    statusPillTextActive: {
      color: colors.onPrimary,
      fontWeight: '900',
    },
    primary: {
      minHeight: 42,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: colors.primaryAction,
      borderWidth: 1,
      borderColor: colors.primaryAction,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryHover: {
      backgroundColor: colors.primaryDeep || colors.primaryAction,
      borderColor: colors.primaryDeep || colors.primaryAction,
    },
    primaryPressed: {
      backgroundColor: colors.primaryDeep || colors.primaryAction,
      borderColor: colors.primaryDeep || colors.primaryAction,
      opacity: 0.92,
      transform: [{ scale: 0.98 }],
    },
    toolbarControlPressed: {
      opacity: 0.88,
      transform: [{ scale: 0.98 }],
    },
    toolbarControlFocus: {
      outlineStyle: 'solid',
      outlineWidth: 3,
      outlineColor: colors.primary,
      outlineOffset: 2,
      },
    primaryText: {
      color: colors.onPrimary,
      fontWeight: '900',
      fontSize: 13,
    },
    notice: {
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.primarySoft,
      borderRadius: 10,
      marginBottom: 16,
    },
    noticeText: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
    },
    skeleton: {
      flexGrow: 1,
      flexBasis: compact ? '100%' : 320,
      maxWidth: compact ? undefined : 460,
    },
    card: {
      flexGrow: 1,
      flexBasis: compact ? '100%' : 320,
      maxWidth: compact ? undefined : 460,
      minWidth: 0,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      ...BLUETAP_LAYOUT.shadow,
    },
    cardTop: {
      flexDirection: 'row',
      gap: 14,
      alignItems: 'flex-start',
    },
    imageSurface: {
      width: 92,
      height: 92,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    },
    image: {
      width: '88%',
      height: '88%',
    },
    placeholder: {
      color: colors.primary,
      fontSize: 28,
      fontWeight: '900',
    },
    productCopy: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    name: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
      lineHeight: 20,
    },
    price: {
      color: colors.primary,
      fontSize: 17,
      fontWeight: '900',
      marginTop: 6,
    },
    detail: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 3,
    },
    policyArea: {
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 10,
    },
    policyRow: {
      gap: 3,
    },
    policyLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    policyValue: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16,
    },
    tagContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 2,
    },
    branchTag: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    branchTagText: {
      color: colors.textPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    dayChip: {
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    dayChipText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '800',
    },
    cardActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    editAction: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editActionText: {
      color: colors.primary,
      fontWeight: '800',
      fontSize: 12,
    },
    statusAction: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deactivateAction: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    deactivateActionText: {
      color: colors.danger,
      fontWeight: '800',
      fontSize: 12,
    },
    activateAction: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    activateActionText: {
      color: colors.success,
      fontWeight: '800',
      fontSize: 12,
    },
    disabledAction: {
      opacity: 0.5,
    },
    pagination: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      marginTop: 20,
      marginBottom: 10,
    },
    pageBtn: {
      minHeight: 36,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageBtnDisabled: {
      opacity: 0.4,
    },
    pageBtnText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    pageBtnTextDisabled: {
      color: colors.textSecondary,
    },
    pageInfo: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    empty: {
      alignItems: 'center',
      padding: 34,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '900',
    },
    emptyText: {
      color: colors.textSecondary,
      marginTop: 6,
    },
    retry: {
      color: colors.primary,
      fontWeight: '900',
      marginTop: 10,
    },
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
    },
    modalScroll: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    },
    modal: {
      width: '100%',
      maxWidth: 680,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 22,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '900',
      marginBottom: 16,
    },
    formGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    field: {
      minWidth: 220,
      flex: 1,
    },
    policySection: {
      marginTop: 16,
      marginBottom: 8,
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    policyEyebrow: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    policyHelp: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 5,
      marginBottom: 8,
    },
    label: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
      marginBottom: 6,
      marginTop: 8,
    },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.input,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: colors.textPrimary,
      outlineStyle: 'none',
    },
    multiline: {
      height: 76,
      paddingTop: 10,
      textAlignVertical: 'top',
    },
    uploadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    preview: {
      width: 100,
      height: 90,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    uploadBtn: {
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadBtnText: {
      color: colors.primary,
      fontWeight: '800',
      fontSize: 12,
    },
    help: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
    },
    branchChoices: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    choice: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.surface,
    },
    choiceActive: {
      backgroundColor: colors.primaryAction,
      borderColor: colors.primaryAction,
    },
    choiceText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    choiceTextActive: {
      color: colors.onPrimary,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 22,
    },
    modalCancelBtn: {
      minHeight: 42,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalCancelText: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 13,
    },
  });
