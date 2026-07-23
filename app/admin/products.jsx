import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  createProduct,
  deleteProduct,
  subscribeProducts,
  updateProduct,
} from '../../services/products';
import AdminShell, {
  ADMIN_COLORS,
  AdminWaterDrop,
} from '../../components/AdminShell';

const emptyForm = {
  product_name: '',
  price: '',
  imageFile: null,
  imagePreview: '',
  imageDataUrl: '',
};

const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;

export default function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeProducts(
      (nextProducts) => {
        setProducts(nextProducts);
        setLoading(false);
      },
      (error) => {
        setLoadError(error.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return products;

    return products.filter((product) =>
      product.product_name.toLowerCase().includes(normalizedSearch)
    );
  }, [products, search]);

  const openAddModal = () => {
    setEditingProduct(null);
    setForm(emptyForm);
    setModalVisible(true);
  };

  const openEditModal = (product) => {
    setEditingProduct(product);
    setForm({
      product_name: product.product_name || '',
      price: String(product.price ?? ''),
      imageFile: null,
      imagePreview: product.image || '',
      imageDataUrl: '',
    });
    setModalVisible(true);
  };

  const closeModal = (forceClose = false) => {
    if (saving && !forceClose) return;
    setModalVisible(false);
    setEditingProduct(null);
    setForm(emptyForm);
  };

  const chooseImage = () => {
    if (!globalThis.document) {
      Alert.alert(
        'Image upload unavailable',
        'Please open the admin panel in a web browser to upload product images.'
      );
      return;
    }

    const input = globalThis.document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) return;

      if (globalThis.FileReader) {
        const reader = new globalThis.FileReader();
        reader.onload = () => {
          setForm((currentForm) => ({
            ...currentForm,
            imageFile: file,
            imagePreview: String(reader.result || ''),
            imageDataUrl: String(reader.result || ''),
          }));
        };
        reader.readAsDataURL(file);
        return;
      }

      const imagePreview = globalThis.URL?.createObjectURL
        ? globalThis.URL.createObjectURL(file)
        : '';

      setForm((currentForm) => ({
        ...currentForm,
        imageFile: file,
        imagePreview,
        imageDataUrl: '',
      }));
    };
    input.click();
  };

  const saveProduct = async () => {
    const productName = form.product_name.trim();
    const parsedPrice = Number(form.price);

    if (!productName) {
      Alert.alert('Missing product name', 'Please enter a product name.');
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      Alert.alert('Invalid price', 'Please enter a valid product price.');
      return;
    }

    try {
      setSaving(true);

      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          product_name: productName,
          price: parsedPrice,
          imageFile: form.imageFile,
          imageDataUrl: form.imageDataUrl,
          existingProduct: editingProduct,
        });
      } else {
        await createProduct({
          product_name: productName,
          price: parsedPrice,
          imageFile: form.imageFile,
          imageDataUrl: form.imageDataUrl,
        });
      }

      closeModal(true);
      Alert.alert(
        'Product saved',
        'This product is now available on the requester dashboard.'
      );
    } catch (error) {
      if (error.savedLocal) {
        closeModal(true);
        Alert.alert(
          'Saved locally',
          error.code === 'operation-timeout'
            ? 'Firebase is taking too long, so the product was saved on this device for now.'
            : 'The product was saved on this device, but Firebase did not accept the change.'
        );
        return;
      }

      Alert.alert('Save failed', error.message);
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (product) => {
    try {
      setDeletingId(product.id);
      await deleteProduct(product);
    } catch (error) {
      Alert.alert('Delete failed', error.message);
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDeleteProduct = (product) => {
    const message = 'Are you sure you want to delete this product?';

    if (globalThis.confirm) {
      if (globalThis.confirm(message)) {
        removeProduct(product);
      }
      return;
    }

    Alert.alert('Delete product', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => removeProduct(product),
      },
    ]);
  };

  return (
    <AdminShell
      active="products"
      title="Products"
      subtitle="Manage refill sizes and pricing"
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search products..."
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Product catalog</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.addButton} onPress={openAddModal}>
            <Text style={styles.addButtonText}>+ Add product</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.tableRow, styles.tableHeadRow]}>
          <Text style={[styles.th, styles.productCol]}>PRODUCT</Text>
          <Text style={[styles.th, styles.priceCol]}>PRICE</Text>
          <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={ADMIN_COLORS.blue} size="small" />
          </View>
        ) : filteredProducts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No products yet.</Text>
            {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
          </View>
        ) : (
          filteredProducts.map((product, index) => {
            const isDeleting = deletingId === product.id;
            const dropColor =
              index % 3 === 0
                ? ADMIN_COLORS.blue
                : index % 3 === 1
                  ? ADMIN_COLORS.cyan
                  : ADMIN_COLORS.green;

            return (
              <View key={product.id} style={styles.tableRow}>
                <View style={[styles.productCell, styles.productCol]}>
                  {product.image ? (
                    <Image
                      source={{ uri: product.image }}
                      style={styles.productImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.dropWrap}>
                      <AdminWaterDrop color={dropColor} size={22} />
                    </View>
                  )}
                  <Text style={styles.productName} numberOfLines={1}>
                    {product.product_name}
                  </Text>
                </View>

                <Text style={[styles.priceText, styles.priceCol]}>
                  {formatPrice(product.price)}
                </Text>

                <View style={[styles.actionsCell, styles.actionsCol]}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.editButton, isDeleting && styles.actionDisabled]}
                    onPress={() => openEditModal(product)}
                    disabled={isDeleting}
                  >
                    <Text style={styles.editButtonText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.deleteButton, isDeleting && styles.actionDisabled]}
                    onPress={() => confirmDeleteProduct(product)}
                    disabled={isDeleting}
                  >
                    <Text style={styles.deleteButtonText}>
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBackground}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingProduct ? 'Edit product' : 'Add product'}
            </Text>

            <Text style={styles.inputLabel}>Product name</Text>
            <TextInput
              style={styles.modalInput}
              value={form.product_name}
              onChangeText={(value) =>
                setForm((currentForm) => ({ ...currentForm, product_name: value }))
              }
              placeholder="Product name"
              placeholderTextColor="#95A6B8"
            />

            <Text style={styles.inputLabel}>Price</Text>
            <TextInput
              style={styles.modalInput}
              value={form.price}
              onChangeText={(value) =>
                setForm((currentForm) => ({ ...currentForm, price: value }))
              }
              placeholder="Price"
              placeholderTextColor="#95A6B8"
              keyboardType="decimal-pad"
            />

            <Text style={styles.inputLabel}>Product image</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.uploadButton} onPress={chooseImage}>
              <Text style={styles.uploadButtonText}>Choose image</Text>
            </TouchableOpacity>

            {!!form.imagePreview && (
              <Image
                source={{ uri: form.imagePreview }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.82}
                style={[styles.cancelButton, saving && styles.actionDisabled]}
                onPress={closeModal}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.saveButton, saving && styles.actionDisabled]}
                onPress={saveProduct}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ADMIN_COLORS.card,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  cardTitle: {
    color: ADMIN_COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  addButton: {
    borderRadius: 20,
    backgroundColor: ADMIN_COLORS.blue,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableRow: {
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: ADMIN_COLORS.border,
  },
  tableHeadRow: {
    minHeight: 38,
  },
  th: {
    color: ADMIN_COLORS.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  productCol: {
    flex: 2.2,
  },
  priceCol: {
    flex: 1,
  },
  actionsCol: {
    flex: 1,
    textAlign: 'right',
  },
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  productImage: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#EEF5FB',
    marginRight: 14,
  },
  dropWrap: {
    width: 34,
    alignItems: 'center',
    marginRight: 8,
  },
  productName: {
    flex: 1,
    color: ADMIN_COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  priceText: {
    color: ADMIN_COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  actionsCell: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editButton: {
    borderRadius: 999,
    backgroundColor: '#E1F8F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonText: {
    color: ADMIN_COLORS.blue,
    fontSize: 12,
    fontWeight: 'bold',
  },
  deleteButton: {
    borderRadius: 999,
    backgroundColor: '#FFE9E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteButtonText: {
    color: ADMIN_COLORS.red,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: ADMIN_COLORS.red,
    fontSize: 12,
    marginTop: 8,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(6, 36, 71, 0.46)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 430,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    padding: 22,
  },
  modalTitle: {
    color: ADMIN_COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 18,
  },
  inputLabel: {
    color: ADMIN_COLORS.muted,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  modalInput: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    borderRadius: 8,
    color: ADMIN_COLORS.text,
    fontSize: 14,
    paddingHorizontal: 12,
    marginBottom: 14,
    outlineStyle: 'none',
  },
  uploadButton: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.blue,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  uploadButtonText: {
    color: ADMIN_COLORS.blue,
    fontSize: 12,
    fontWeight: 'bold',
  },
  imagePreview: {
    width: 120,
    height: 86,
    borderRadius: 8,
    backgroundColor: '#EEF5FB',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    minWidth: 92,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.blue,
    backgroundColor: '#FFFFFF',
  },
  cancelButtonText: {
    color: ADMIN_COLORS.blue,
    fontSize: 13,
    fontWeight: 'bold',
  },
  saveButton: {
    minWidth: 92,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: ADMIN_COLORS.blue,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
