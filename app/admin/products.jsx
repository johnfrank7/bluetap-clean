import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import {
  createProduct,
  deleteProduct,
  subscribeProducts,
  updateProduct,
} from '../../services/products';
import { signOutAndClearSessions } from '../../services/authSession';
import { createShadow } from '../../components/shadowStyles';

const emptyForm = {
  product_name: '',
  price: '',
  imageFile: null,
  imagePreview: '',
  imageDataUrl: '',
};

const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;

export default function AdminProductsPage() {
  const router = useRouter();
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

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

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
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* Sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.stationHeader}>
            <Image
              source={require('../../assets/icons/bluetaplogo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.stationName}>Station Name</Text>
          </View>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/dashboard')}
          >
            <Text style={styles.navItemText}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={() => router.replace('/admin/products')}
          >
            <Text style={[styles.navItemText, styles.navItemTextActive]}>Products</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/request')}
          >
            <Text style={styles.navItemText}>Request</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navItemText}>Profile</Text>
          </TouchableOpacity>

          <View style={styles.sidebarFooter}>
            <Text style={styles.footerBrand}>BlueTap</Text>
          </View>
        </View>

        {/* Main content */}
        <View style={styles.main}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor="#B0BEC5"
                value={search}
                onChangeText={setSearch}
              />
              <TouchableOpacity style={styles.searchButton}>
                <Text style={styles.searchIcon}>{'\u{1F50D}'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>LOGOUT</Text>
            </TouchableOpacity>
          </View>

          {/* Product list table */}
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Products</Text>
                <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
                  <Text style={styles.addButtonText}>Add Product</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.row, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellImageHeader]}>Product Image</Text>
                <Text style={[styles.cell, styles.cellNameHeader]}>Product Name</Text>
                <Text style={[styles.cell, styles.cellPriceHeader]}>Price</Text>
                <Text style={[styles.cell, styles.cellActionsHeader]}>Actions</Text>
              </View>

              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : filteredProducts.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No products yet.</Text>
                  {!!loadError && (
                    <Text style={styles.errorText}>Firestore: {loadError}</Text>
                  )}
                </View>
              ) : (
                filteredProducts.map((product, idx) => {
                  const isDeleting = deletingId === product.id;

                  return (
                    <View
                      key={product.id}
                      style={[styles.row, idx % 2 === 1 && styles.rowStriped]}
                    >
                      <View style={[styles.cell, styles.cellImage]}>
                        {product.image ? (
                          <Image
                            source={{ uri: product.image }}
                            style={styles.productImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.productImagePlaceholder}>
                            <Text style={styles.productImagePlaceholderText}>No image</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.cell, styles.cellName]}>
                        {product.product_name}
                      </Text>
                      <Text style={[styles.cell, styles.cellPrice]}>
                        {formatPrice(product.price)}
                      </Text>
                      <View style={[styles.cell, styles.cellActions]}>
                        <TouchableOpacity
                          style={[styles.editButton, isDeleting && styles.actionDisabled]}
                          onPress={() => openEditModal(product)}
                          disabled={isDeleting}
                        >
                          <Text style={styles.editButtonText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
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
          </ScrollView>
        </View>
      </View>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </Text>

            <Text style={styles.inputLabel}>Product Name</Text>
            <TextInput
              style={styles.modalInput}
              value={form.product_name}
              onChangeText={(value) =>
                setForm((currentForm) => ({ ...currentForm, product_name: value }))
              }
              placeholder="Product Name"
              placeholderTextColor="#B0BEC5"
            />

            <Text style={styles.inputLabel}>Price</Text>
            <TextInput
              style={styles.modalInput}
              value={form.price}
              onChangeText={(value) =>
                setForm((currentForm) => ({ ...currentForm, price: value }))
              }
              placeholder="Price"
              placeholderTextColor="#B0BEC5"
              keyboardType="decimal-pad"
            />

            <Text style={styles.inputLabel}>Upload Image</Text>
            <TouchableOpacity style={styles.uploadButton} onPress={chooseImage}>
              <Text style={styles.uploadButtonText}>Choose Image</Text>
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
                style={[styles.cancelButton, saving && styles.actionDisabled]}
                onPress={closeModal}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F4F7',
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },

  /* Sidebar */
  sidebar: {
    width: 260,
    backgroundColor: '#187BCD',
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  stationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 32,
    height: 32,
    marginRight: 10,
  },
  stationName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  navItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginBottom: 6,
  },
  navItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  navItemText: {
    color: '#E3F2FD',
    fontSize: 14,
  },
  navItemTextActive: {
    fontWeight: 'bold',
  },

  sidebarFooter: {
    marginTop: 'auto',
    paddingVertical: 16,
  },
  footerBrand: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  /* Main area */
  main: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#455A64',
  },
  searchButton: {
    width: 44,
    height: '100%',
    backgroundColor: '#187BCD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    color: '#FFFFFF',
    fontSize: 18,
  },

  logoutButton: {
    marginLeft: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#187BCD',
    backgroundColor: '#FFFFFF',
  },
  logoutText: {
    color: '#187BCD',
    fontWeight: '600',
    fontSize: 13,
  },

  cardScroll: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    ...createShadow({
      color: '#000',
      elevation: 3,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 2 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
  },
  addButtonText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F1F1',
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  rowStriped: {
    backgroundColor: '#FAFAFA',
  },
  cell: {
    fontSize: 14,
    color: '#455A64',
  },
  cellImageHeader: { flex: 1.2, fontWeight: 'bold' },
  cellNameHeader: { flex: 2, fontWeight: 'bold' },
  cellPriceHeader: { flex: 1, fontWeight: 'bold' },
  cellActionsHeader: { flex: 1.5, fontWeight: 'bold', textAlign: 'right' },
  cellImage: { flex: 1.2 },
  cellName: { flex: 2 },
  cellPrice: { flex: 1 },
  cellActions: {
    flex: 1.5,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  productImage: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#F2F4F7',
  },
  productImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImagePlaceholderText: {
    color: '#90A4AE',
    fontSize: 10,
    textAlign: 'center',
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
  },
  editButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#757575',
    fontSize: 14,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 20,
  },
  modalTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 14,
  },
  inputLabel: {
    color: '#455A64',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#455A64',
    fontSize: 14,
    marginBottom: 12,
  },
  uploadButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  uploadButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  imagePreview: {
    width: 120,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#F2F4F7',
    marginBottom: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1.5,
    borderColor: '#2563EB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
  },
  cancelButtonText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: '#187BCD',
    ...createShadow({
      color: '#187BCD',
      elevation: 3,
      opacity: 0.16,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
