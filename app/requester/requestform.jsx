import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../../firebase';
import { findLocalUserByEmail, getLocalUsers } from '../../localUsers';
import { createRequest } from '../../services/requests';
import { subscribeProducts } from '../../services/products';

const containerOptions = ['New Container', 'Exchange'];
const waterStationOptions = ['aquabea', 'bluetap'];

const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;
const getParamValue = (value) => (Array.isArray(value) ? value[0] : value);

const getDefaultDeliveryDate = () => {
  const now = new Date();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).formatToParts(now);
    const datePartMap = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );

    return `${datePartMap.month} - ${datePartMap.day} - ${datePartMap.year}`;
  } catch (error) {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${month} - ${day} - ${now.getFullYear()}`;
  }
};

const emptyRequesterInfo = {
  id: '',
  fullName: 'Not set',
  phone: 'Not set',
  address: 'Not set',
  email: '',
};

const buildOrderItem = (product, quantity = 1) => ({
  product_id: product.id,
  product_name: product.product_name,
  product_price: Number(product.price || 0),
  image: product.image || '',
  quantity,
});

export default function RequestFormPage() {
  const router = useRouter();
  const { productId } = useLocalSearchParams();
  const productIdParam = getParamValue(productId);

  const [products, setProducts] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [requesterInfo, setRequesterInfo] = useState(emptyRequesterInfo);
  const [container, setContainer] = useState('New Container');
  const [waterStation, setWaterStation] = useState('bluetap');
  const [showProducts, setShowProducts] = useState(!productIdParam);
  const [showContainers, setShowContainers] = useState(false);
  const [showStations, setShowStations] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const deliveryDate = useMemo(getDefaultDeliveryDate, []);

  useEffect(() => {
    const unsubscribe = subscribeProducts((nextProducts) => {
      setProducts(nextProducts);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!productIdParam || products.length === 0) return;

    const selectedProduct = products.find((product) => product.id === productIdParam);
    if (!selectedProduct) return;

    setOrderItems((currentItems) => {
      if (currentItems.some((item) => item.product_id === selectedProduct.id)) {
        return currentItems;
      }

      return [...currentItems, buildOrderItem(selectedProduct, 1)];
    });
  }, [productIdParam, products]);

  useEffect(() => {
    const loadRequesterInfo = async () => {
      const user = auth.currentUser;
      let profile = null;

      if (user) {
        profile = findLocalUserByEmail(user.email);

        try {
          const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
          if (profileSnapshot.exists()) {
            profile = {
              ...profile,
              ...profileSnapshot.data(),
              uid: user.uid,
              email: profileSnapshot.data().email || user.email,
            };
          }
        } catch (error) {
          console.log('Requester profile read error:', error.message);
        }

        profile = {
          ...profile,
          uid: user.uid,
          email: user.email || profile?.email || '',
        };
      } else {
        profile = getLocalUsers().find((localUser) => localUser.role === 'requester');
      }

      const fullName =
        `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() ||
        profile?.email ||
        'Not set';

      setRequesterInfo({
        id: profile?.uid || '',
        fullName,
        phone: profile?.phone || 'Not set',
        address: profile?.address || 'Not set',
        email: profile?.email || '',
      });
    };

    loadRequesterInfo();
  }, []);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const syncedOrderItems = useMemo(
    () =>
      orderItems.map((item) => {
        const currentProduct = productMap.get(item.product_id);
        const productPrice = Number(
          currentProduct?.price ?? item.product_price ?? 0
        );

        return {
          ...item,
          product_name: currentProduct?.product_name || item.product_name,
          product_price: productPrice,
          image: currentProduct?.image || item.image,
          line_total: productPrice * item.quantity,
        };
      }),
    [orderItems, productMap]
  );

  const totalQuantity = useMemo(
    () => syncedOrderItems.reduce((sum, item) => sum + item.quantity, 0),
    [syncedOrderItems]
  );

  const totalCost = useMemo(
    () => syncedOrderItems.reduce((sum, item) => sum + item.line_total, 0),
    [syncedOrderItems]
  );

  const addProduct = (product) => {
    setOrderItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.product_id === product.id);

      if (existingItem) {
        return currentItems.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...currentItems, buildOrderItem(product, 1)];
    });
  };

  const updateItemQuantity = (productIdToUpdate, delta) => {
    setOrderItems((currentItems) =>
      currentItems
        .map((item) =>
          item.product_id === productIdToUpdate
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeItem = (productIdToRemove) => {
    setOrderItems((currentItems) =>
      currentItems.filter((item) => item.product_id !== productIdToRemove)
    );
  };

  const validateRequest = () => {
    if (!requesterInfo.id) {
      Alert.alert('Missing requester', 'Please log in again before submitting a request.');
      return false;
    }

    if (syncedOrderItems.length === 0) {
      Alert.alert('Choose product', 'Please add at least one product to your order.');
      return false;
    }

    if (totalQuantity < 1) {
      Alert.alert('Invalid quantity', 'Please add at least one product.');
      return false;
    }

    if (!waterStation) {
      Alert.alert('Choose station', 'Please choose a water station.');
      return false;
    }

    return true;
  };

  const openSummary = () => {
    if (validateRequest()) {
      setSummaryVisible(true);
    }
  };

  const confirmOrder = async () => {
    if (!validateRequest()) return;

    try {
      setSubmitting(true);

      await createRequest({
        requester_id: requesterInfo.id,
        requester_name: requesterInfo.fullName,
        contact_number: requesterInfo.phone,
        address: requesterInfo.address,
        product_name: syncedOrderItems.map((item) => item.product_name).join(', '),
        quantity: totalQuantity,
        items: syncedOrderItems.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          product_price: item.product_price,
          quantity: item.quantity,
          line_total: item.line_total,
        })),
        container,
        water_station: waterStation,
        delivery_date: deliveryDate,
        total_cost: totalCost,
      });

      setSummaryVisible(false);
      Alert.alert('Request submitted', 'Your order has been submitted.');
      router.replace('/requester/r_dashboard');
    } catch (error) {
      if (error.savedLocal) {
        setSummaryVisible(false);
        Alert.alert(
          'Saved locally',
          'Your order was saved on this device, but Firebase did not accept the request.'
        );
        router.replace('/requester/r_dashboard');
        return;
      }

      Alert.alert('Submit failed', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* NEW REQUEST title */}
            <Text style={styles.pageTitle}>NEW REQUEST</Text>

            {/* Requester Information section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Requester Information</Text>
              <View style={styles.sectionDivider} />

              <View style={styles.infoRow}>
                <Text style={styles.fieldLabel}>Full Name</Text>
                <Text style={styles.infoValue}>{requesterInfo.fullName}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.fieldLabel}>Contact Number</Text>
                <Text style={styles.infoValue}>{requesterInfo.phone}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.fieldLabel}>Address</Text>
                <Text style={styles.infoValue}>{requesterInfo.address}</Text>
              </View>
            </View>

            {/* Order Details section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order Details</Text>
              <View style={styles.sectionDivider} />

              <View style={styles.inlineRow}>
                <Text style={styles.fieldLabel}>Products</Text>
                <TouchableOpacity
                  style={styles.productToggleButton}
                  onPress={() => setShowProducts((isVisible) => !isVisible)}
                >
                  <Text style={styles.productToggleText}>
                    {showProducts ? 'Hide products' : 'Add products'}
                  </Text>
                </TouchableOpacity>
              </View>

              {showProducts && (
                <View style={styles.productPicker}>
                  {products.length === 0 ? (
                    <Text style={styles.optionText}>No products available</Text>
                  ) : (
                    products.map((product) => {
                      const selectedItem = syncedOrderItems.find(
                        (item) => item.product_id === product.id
                      );

                      return (
                        <View style={styles.productOption} key={product.id}>
                          {product.image ? (
                            <Image
                              source={{ uri: product.image }}
                              style={styles.productOptionImage}
                              resizeMode="contain"
                            />
                          ) : (
                            <Image
                              source={require('../../assets/icons/bluetaplogo.png')}
                              style={styles.productOptionImage}
                              resizeMode="contain"
                            />
                          )}

                          <View style={styles.productOptionTextWrap}>
                            <Text style={styles.productOptionName} numberOfLines={2}>
                              {product.product_name}
                            </Text>
                            <Text style={styles.productOptionPrice}>
                              {formatPrice(product.price)}
                            </Text>
                          </View>

                          <TouchableOpacity
                            style={styles.addProductButton}
                            onPress={() => addProduct(product)}
                          >
                            <Text style={styles.addProductText}>
                              {selectedItem ? `+ ${selectedItem.quantity}` : 'Add'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              <View style={styles.selectedItemsBox}>
                {syncedOrderItems.length === 0 ? (
                  <Text style={styles.selectedEmptyText}>No product selected.</Text>
                ) : (
                  syncedOrderItems.map((item) => (
                    <View style={styles.selectedItemRow} key={item.product_id}>
                      <View style={styles.selectedItemTextWrap}>
                        <Text style={styles.selectedItemName} numberOfLines={2}>
                          {item.product_name}
                        </Text>
                        <Text style={styles.selectedItemMeta}>
                          {formatPrice(item.product_price)} x {item.quantity} ={' '}
                          {formatPrice(item.line_total)}
                        </Text>
                      </View>

                      <View style={styles.quantityRow}>
                        <TouchableOpacity
                          style={styles.squareButton}
                          onPress={() => updateItemQuantity(item.product_id, 1)}
                        >
                          <Text style={styles.squareButtonText}>+</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.squareButton}
                          onPress={() => updateItemQuantity(item.product_id, -1)}
                        >
                          <Text style={styles.squareButtonText}>-</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeItemButton}
                          onPress={() => removeItem(item.product_id)}
                        >
                          <Text style={styles.removeItemText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.fieldLabel}>Container</Text>
              <TouchableOpacity
                style={styles.selectorBox}
                onPress={() => setShowContainers((isVisible) => !isVisible)}
              >
                <Text style={styles.selectorText}>{container}</Text>
              </TouchableOpacity>
              {showContainers && (
                <View style={styles.optionsBox}>
                  {containerOptions.map((option) => (
                    <TouchableOpacity
                      style={styles.optionItem}
                      key={option}
                      onPress={() => {
                        setContainer(option);
                        setShowContainers(false);
                      }}
                    >
                      <Text style={styles.optionText}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>Water Station</Text>
              <TouchableOpacity
                style={styles.selectorBox}
                onPress={() => setShowStations((isVisible) => !isVisible)}
              >
                <Text style={styles.selectorText}>{waterStation || 'Choose station'}</Text>
              </TouchableOpacity>
              {showStations && (
                <View style={styles.optionsBox}>
                  {waterStationOptions.map((option) => (
                    <TouchableOpacity
                      style={styles.optionItem}
                      key={option}
                      onPress={() => {
                        setWaterStation(option);
                        setShowStations(false);
                      }}
                    >
                      <Text style={styles.optionText}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.inlineRow}>
                <Text style={styles.fieldLabel}>Delivery Date</Text>
                <Text style={styles.dateText}>{deliveryDate}</Text>
              </View>
              <View style={styles.sectionDivider} />
            </View>

            <View style={styles.section}>
              <View style={styles.inlineRow}>
                <Text style={styles.sectionTitle}>Total Cost</Text>
                <Text style={styles.totalCostText}>{formatPrice(totalCost)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.buttonDisabled]}
              onPress={openSummary}
              disabled={submitting}
            >
              <Text style={styles.submitText}>
                {submitting ? 'Submitting...' : 'Submit request'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => router.replace('/requester/r_dashboard')}
              disabled={submitting}
            >
              <Text style={styles.cancelText}>Cancel request</Text>
            </TouchableOpacity>
          </ScrollView>

        </View>

        <Modal visible={summaryVisible} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Order Summary</Text>

              <Text style={styles.summaryText}>Requester: {requesterInfo.fullName}</Text>
              <Text style={styles.summaryText}>Container: {container}</Text>
              <Text style={styles.summaryText}>Water Station: {waterStation}</Text>
              <Text style={styles.summaryText}>Delivery Date: {deliveryDate}</Text>

              <View style={styles.summaryDivider} />

              {syncedOrderItems.map((item) => (
                <Text style={styles.summaryText} key={item.product_id}>
                  {item.product_name}: {item.quantity} x {formatPrice(item.product_price)}
                </Text>
              ))}

              <Text style={styles.summaryTotal}>Total Cost: {formatPrice(totalCost)}</Text>

              <TouchableOpacity
                style={[styles.modalButton, submitting && styles.buttonDisabled]}
                onPress={confirmOrder}
                disabled={submitting}
              >
                <Text style={styles.modalButtonText}>
                  {submitting ? 'Confirming...' : 'Confirm order'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setSummaryVisible(false)}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  phoneWrapper: { width: '100%', maxWidth: 375, alignSelf: 'center', flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 140,
  },
  pageTitle: {
    marginTop: 32,
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  section: { marginTop: 20 },
  sectionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  sectionDivider: {
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
    marginBottom: 6,
  },
  fieldLabel: { color: '#FFFFFF', fontSize: 13, marginTop: 6 },
  infoRow: {
    marginTop: 6,
  },
  infoValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 2,
  },
  inlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  productToggleButton: {
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  productToggleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  productPicker: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 6,
    padding: 8,
  },
  productOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.25)',
  },
  productOptionImage: {
    width: 42,
    height: 42,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
  },
  productOptionTextWrap: {
    flex: 1,
  },
  productOptionName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  productOptionPrice: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 2,
  },
  addProductButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  addProductText: {
    color: '#187BCD',
    fontSize: 12,
    fontWeight: 'bold',
  },
  selectedItemsBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    borderRadius: 6,
    padding: 8,
  },
  selectedEmptyText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  selectedItemRow: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.22)',
  },
  selectedItemTextWrap: {
    marginBottom: 6,
  },
  selectedItemName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  selectedItemMeta: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 2,
  },
  quantityRow: { flexDirection: 'row', alignItems: 'center' },
  squareButton: {
    width: 26,
    height: 22,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  squareButtonText: { color: '#187BCD', fontSize: 14, fontWeight: 'bold' },
  removeItemButton: {
    height: 22,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  removeItemText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  selectorBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 3,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  selectorText: { color: '#FFFFFF', fontSize: 13 },
  optionsBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  optionItem: {
    paddingVertical: 6,
  },
  optionText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  dateText: { color: '#FFFFFF', fontSize: 13 },
  totalCostText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  submitButton: {
    marginTop: 26,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  submitText: { color: '#187BCD', fontSize: 15, fontWeight: 'bold' },
  cancelButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
  buttonDisabled: { opacity: 0.7 },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#187BCD',
    textAlign: 'center',
  },
  summaryText: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 7,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 8,
  },
  summaryTotal: {
    color: '#187BCD',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 6,
    marginBottom: 16,
  },
  modalButton: {
    width: '100%',
    backgroundColor: '#187BCD',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: { color: '#fff', fontWeight: 'bold' },
  modalCancel: { marginTop: 12, alignItems: 'center' },
  modalCancelText: { color: '#187BCD', fontWeight: 'bold' },
});
