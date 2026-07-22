import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Carousel from 'react-native-reanimated-carousel';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebase';
import { findLocalUserForAuthRole } from '../../localUsers';
import RequestDetailsModal from '../../components/RequestDetailsModal';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import { subscribeProducts } from '../../services/products';
import {
  cancelRequest,
  subscribeRequesterCurrentRequests,
} from '../../services/requests';

const PHONE_MAX_WIDTH = 375;
const DASHBOARD_HORIZONTAL_PADDING = 34;
const PRODUCT_CARD_WIDTH_RATIO = 0.88;
const PRODUCT_CAROUSEL_HEIGHT = 226;
const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';
const REQUESTER_NAME = 'Requester';
const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;
const formatDashboardDate = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
const formatRequestDate = (value) => {
  if (!value) return 'Not set';

  let dateValue = null;

  if (value instanceof Date) {
    dateValue = value;
  } else if (typeof value?.toDate === 'function') {
    dateValue = value.toDate();
  } else if (typeof value?.toMillis === 'function') {
    dateValue = new Date(value.toMillis());
  } else if (value?.seconds) {
    dateValue = new Date(value.seconds * 1000);
  } else if (typeof value === 'string') {
    const formDateMatch = value.match(
      /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/
    );

    if (formDateMatch) {
      dateValue = new Date(
        Number(formDateMatch[3]),
        Number(formDateMatch[1]) - 1,
        Number(formDateMatch[2])
      );
    } else {
      dateValue = new Date(value);
    }
  }

  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(dateValue);
};
const normalizeRequestItem = (item, fallback = {}) => {
  const quantity = Number(item?.quantity || 0);
  const unitPrice = Number(item?.product_price ?? item?.price ?? 0);
  const lineTotal = Number(
    item?.line_total ?? (Number.isFinite(unitPrice) ? unitPrice * quantity : 0)
  );

  return {
    id: item?.product_id || fallback.id || fallback.product_id || '',
    product_name:
      item?.product_name || item?.productName || fallback.product_name || 'Product',
    quantity: Number.isFinite(quantity) ? quantity : 0,
    product_price: Number.isFinite(unitPrice) ? unitPrice : 0,
    line_total: Number.isFinite(lineTotal) ? lineTotal : 0,
  };
};
const getRequestItems = (request) => {
  if (!request) return [];

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.map((item, index) =>
      normalizeRequestItem(item, {
        id: `${request.id || request.request_id || 'request'}-${index}`,
        product_name: request.product_name,
      })
    );
  }

  if (!request.product_name) return [];

  const quantity = Number(request.quantity || 0);
  const unitPrice = Number(request.product_price || 0);
  const totalCost = Number(request.total_cost || 0);

  return [
    normalizeRequestItem(
      {
        product_id: request.product_id,
        product_name: request.product_name,
        product_price: unitPrice || (quantity > 0 ? totalCost / quantity : 0),
        quantity,
        line_total: totalCost,
      },
      request
    ),
  ];
};
const getRequestProductName = (request) => {
  if (!request) return 'Not set';
  if (Array.isArray(request.items) && request.items.length > 0) {
    const productNames = request.items
      .map((item) => item.product_name)
      .filter(Boolean);

    if (productNames.length > 0) {
      return productNames.join(', ');
    }
  }

  return request.product_name || 'Not set';
};
const getCardProductSummary = (request) => {
  const items = getRequestItems(request);

  if (items.length === 0) return getRequestProductName(request);

  const firstProductName = items[0].product_name || 'Product';

  return items.length > 1
    ? `${firstProductName} +${items.length - 1} more`
    : firstProductName;
};
const getRequestQuantityText = (request) => {
  if (!request) return 'Not set';

  const quantity = Number(request.quantity);

  if (Number.isFinite(quantity) && quantity > 0) {
    return String(quantity);
  }

  if (Array.isArray(request.items) && request.items.length > 0) {
    const totalQuantity = request.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    if (totalQuantity > 0) {
      return String(totalQuantity);
    }
  }

  return request.quantity ? String(request.quantity) : 'Not set';
};
const getRequestTotalAmount = (request) => {
  const totalAmount = Number(request?.total_cost || 0);

  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return totalAmount;
  }

  return getRequestItems(request).reduce(
    (sum, item) => sum + Number(item.line_total || 0),
    0
  );
};
const getNormalizedStatus = (status) =>
  (status || '')
    .toString()
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
const isPendingRequest = (request) =>
  getNormalizedStatus(request.status) === 'pending';
const getProductGallons = (product) => {
  const sizeText =
    product.capacity ||
    product.gallons ||
    product.gallon ||
    product.volume ||
    product.size ||
    '';

  if (!sizeText) return '';

  const normalizedSizeText = String(sizeText).trim().toLowerCase();
  const normalizedProductName = String(product.product_name || '')
    .trim()
    .toLowerCase();

  return normalizedSizeText === normalizedProductName ? '' : String(sizeText);
};
const getProductStockText = (product) => {
  const statusText =
    product.stockAvailability ||
    product.stock_availability ||
    product.stockStatus ||
    product.stock_status ||
    product.availability;

  if (statusText) return String(statusText);

  const stockValue =
    product.stock ??
    product.stocks ??
    product.inventory ??
    product.available_stock ??
    product.quantity_available;

  if (stockValue === undefined || stockValue === null || stockValue === '') {
    return '';
  }

  if (typeof stockValue === 'boolean') {
    return stockValue ? 'In stock' : 'Out of stock';
  }

  const numericStock = Number(stockValue);

  if (Number.isFinite(numericStock)) {
    return numericStock > 0 ? `${numericStock} in stock` : 'Out of stock';
  }

  return String(stockValue);
};
const isUnavailableStock = (stockText) =>
  stockText.toLowerCase().includes('out') ||
  stockText.toLowerCase().includes('unavailable');

export default function RequesterDashboard() {
  const router = useRouter(); 
  const productCarouselRef = useRef(null);
  const { width: windowWidth } = useWindowDimensions();
  const todayText = formatDashboardDate(new Date());
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [currentRequests, setCurrentRequests] = useState([]);
  const [cancellingRequestId, setCancellingRequestId] = useState('');
  const [requestToCancel, setRequestToCancel] = useState(null);
  const [detailsRequest, setDetailsRequest] = useState(null);
  const [notification, setNotification] = useState(null);
  const productCarouselWidth = Math.max(1, Math.min(windowWidth, PHONE_MAX_WIDTH));
  const productCarouselItemWidth = Math.max(
    1,
    Math.round(productCarouselWidth * PRODUCT_CARD_WIDTH_RATIO)
  );
  const productCarouselSideInset =
    (productCarouselWidth - productCarouselItemWidth) / 2;

  useEffect(() => {
    const unsubscribe = subscribeProducts(
      (nextProducts) => {
        setProducts(nextProducts);
        setProductsLoading(false);
      },
      () => {
        setProductsLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (products.length === 0) {
      setActiveProductIndex(0);
      return;
    }

    if (activeProductIndex > products.length - 1) {
      setActiveProductIndex(0);
    }
  }, [activeProductIndex, products.length]);

  useEffect(() => {
    let activeRequesterId = '';
    let unsubscribeRequests = () => {};

    const getRequesterId = (user) => {
      if (!user) return '';

      const localRequester = findLocalUserForAuthRole(user, 'requester');
      return localRequester?.uid || '';
    };

    const subscribeForRequester = (requesterId) => {
      const normalizedRequesterId = (requesterId || '').toString().trim();

      if (normalizedRequesterId === activeRequesterId) return;

      unsubscribeRequests();
      activeRequesterId = normalizedRequesterId;

      if (!normalizedRequesterId) {
        setCurrentRequests([]);
        return;
      }

      unsubscribeRequests = subscribeRequesterCurrentRequests(
        normalizedRequesterId,
        setCurrentRequests
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      subscribeForRequester(getRequesterId(user));
    });

    return () => {
      unsubscribeAuth();
      unsubscribeRequests();
    };
  }, []);

  const cancelPendingRequest = async (request) => {
    if (cancellingRequestId) return;

    try {
      setCancellingRequestId(request.id);
      await cancelRequest(request);
      setCurrentRequests((requests) =>
        requests.filter((currentRequest) => currentRequest.id !== request.id)
      );
      setNotification({
        title: 'Request Cancelled',
        message: 'Your pending request has been cancelled.',
      });
    } catch (error) {
      if (error.savedLocal) {
        setCurrentRequests((requests) =>
          requests.filter((currentRequest) => currentRequest.id !== request.id)
        );
        setNotification({
          title: 'Saved Locally',
          message:
            'Your request was cancelled on this device, but Firebase did not accept the update.',
        });
        return;
      }

      Alert.alert('Cancel failed', error.message);
    } finally {
      setCancellingRequestId('');
    }
  };

  const confirmCancelRequest = (request) => {
    setRequestToCancel(request);
  };

  const closeCancelModal = () => {
    if (requestToCancel?.id && cancellingRequestId === requestToCancel.id) return;

    setRequestToCancel(null);
  };

  const proceedWithCancelRequest = async () => {
    if (!requestToCancel) return;

    const selectedRequest = requestToCancel;
    setRequestToCancel(null);
    await cancelPendingRequest(selectedRequest);
  };

  const openProductRequest = useCallback(
    (productId) => {
      router.push({
        pathname: '/requester/requestform',
        params: { productId },
      });
    },
    [router]
  );

  const renderProductCard = useCallback(
    ({ item: product }) => {
      const stockText = getProductStockText(product);
      const productGallons = getProductGallons(product);

      return (
        <View style={styles.productCarouselItem}>
          <View style={styles.productCard}>
            <View style={styles.priceBadge}>
              <Text style={styles.priceBadgeText}>
                {formatPrice(product.price)}
              </Text>
            </View>

            <View style={styles.productImageWrap}>
              {product.image ? (
                <Image
                  source={{ uri: product.image }}
                  style={styles.productImage}
                  resizeMode="contain"
                />
              ) : (
                <Image
                  source={require('../../assets/icons/bluetaplogo.png')}
                  style={styles.productImage}
                  resizeMode="contain"
                />
              )}
            </View>

            <View style={styles.productDetails}>
              <Text style={styles.productName} numberOfLines={2}>
                {product.product_name}
              </Text>
              {!!productGallons && (
                <Text style={styles.productGallons} numberOfLines={1}>
                  {productGallons}
                </Text>
              )}
              {!!stockText && (
                <Text
                  style={[
                    styles.productStock,
                    isUnavailableStock(stockText) && styles.productStockUnavailable,
                  ]}
                  numberOfLines={1}
                >
                  {stockText}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={styles.orderButton}
              activeOpacity={0.85}
              onPress={() => openProductRequest(product.id)}
            >
              <Text style={styles.orderButtonText}>Order</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [openProductRequest]
  );

  const productCarouselAnimation = useCallback(
    (value) => {
      'worklet';

      return {
        transform: [
          {
            translateX:
              productCarouselSideInset + value * productCarouselItemWidth,
          },
        ],
      };
    },
    [productCarouselItemWidth, productCarouselSideInset]
  );
  const detailsRequestData = detailsRequest
    ? {
        requestId: detailsRequest.request_id || detailsRequest.id,
        status: detailsRequest.status || 'Pending',
        orderDate: formatRequestDate(detailsRequest.created_at),
        deliveryDate: formatRequestDate(detailsRequest.delivery_date),
        product: getCardProductSummary(detailsRequest),
        containerType: detailsRequest.container || 'Not set',
        quantity: getRequestQuantityText(detailsRequest),
        totalAmount: getRequestTotalAmount(detailsRequest),
        waterStation: detailsRequest.water_station || 'Not set',
        paymentMethod:
          detailsRequest.payment_method ||
          detailsRequest.paymentMethod ||
          'Not set',
        customerName: detailsRequest.requester_name || 'Not set',
        contactNumber: detailsRequest.contact_number || 'Not set',
        deliveryAddress: detailsRequest.address || 'Not set',
        items: getRequestItems(detailsRequest),
        grandTotalAmount: getRequestTotalAmount(detailsRequest),
      }
    : null;

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
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={styles.welcomeSection}>
              <Text style={styles.welcomeText}>WELCOME!</Text>
              <Text style={styles.greetingText}>
                Good Morning, {REQUESTER_NAME}
              </Text>
              <Text style={styles.dateText}>{todayText}</Text>
            </View>

            <View style={styles.productsSection}>
              {productsLoading ? (
                <View style={styles.productStateCard}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : products.length === 0 ? (
                <View style={styles.productStateCard}>
                  <Text style={styles.productName}>No products available.</Text>
                </View>
              ) : (
                <>
                  <Carousel
                    ref={productCarouselRef}
                    data={products}
                    loop={products.length > 1}
                    style={[
                      styles.productCarousel,
                      {
                        width: productCarouselWidth,
                        height: PRODUCT_CAROUSEL_HEIGHT,
                        marginLeft: -DASHBOARD_HORIZONTAL_PADDING,
                      },
                    ]}
                    itemWidth={productCarouselItemWidth}
                    itemHeight={PRODUCT_CAROUSEL_HEIGHT}
                    scrollAnimationDuration={450}
                    customAnimation={productCarouselAnimation}
                    onSnapToItem={setActiveProductIndex}
                    renderItem={renderProductCard}
                  />

                  <View style={styles.paginationDots}>
                    {products.map((product, index) => (
                      <TouchableOpacity
                        key={product.id}
                        style={[
                          styles.paginationDot,
                          activeProductIndex === index && styles.paginationDotActive,
                        ]}
                        activeOpacity={0.75}
                        onPress={() => {
                          productCarouselRef.current?.scrollTo({
                            index,
                            animated: true,
                          });
                          setActiveProductIndex(index);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${product.product_name}`}
                      />
                    ))}
                  </View>
                </>
              )}
            </View>

            <View style={styles.currentRequestSection}>
              <Text style={styles.currentRequestLabel}>Current Request</Text>

              {currentRequests.length === 0 ? (
                <View style={styles.emptyRequestCard}>
                  <Text style={styles.emptyRequestTitle}>No current request.</Text>
                  <Text style={styles.emptyRequestText}>
                    Your active orders will appear here once you place a request.
                  </Text>
                </View>
              ) : (
                currentRequests.map((request, index) => {
                  const isRequestPending = isPendingRequest(request);

                  return (
                    <View
                      style={[
                        styles.currentRequestCard,
                        index > 0 && styles.currentRequestCardGap,
                      ]}
                      key={request.id}
                    >
                      <View style={styles.requestCardHeader}>
                        <Text style={styles.requestId} numberOfLines={1}>
                          Request ID: {request.request_id || request.id}
                        </Text>
                        <SoftStatusBadge status={request.status} />
                      </View>

                      <View style={styles.requestDetailsGrid}>
                        <View style={styles.requestInfoRow}>
                          <View style={styles.requestInfoBlock}>
                            <Text style={styles.requestInfoLabel}>Product</Text>
                            <Text
                              style={styles.requestInfoPrimaryValue}
                              numberOfLines={2}
                            >
                              {getCardProductSummary(request)}
                            </Text>
                          </View>

                          <View style={styles.requestInfoBlock}>
                            <Text style={styles.requestInfoLabel}>
                              Container Type
                            </Text>
                            <Text style={styles.requestInfoValue} numberOfLines={2}>
                              {request.container || 'Not set'}
                            </Text>
                          </View>
                        </View>

                        <View style={[styles.requestInfoRow, styles.requestInfoRowSpaced]}>
                          <View style={styles.requestInfoBlock}>
                            <Text style={styles.requestInfoLabel}>Quantity</Text>
                            <Text style={styles.requestInfoValue}>
                              {getRequestQuantityText(request)}
                            </Text>
                          </View>

                          <View style={styles.requestInfoBlock}>
                            <Text style={styles.requestInfoLabel}>Total Amount</Text>
                            <Text style={styles.requestInfoValue}>
                              {formatPrice(getRequestTotalAmount(request))}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.cardActionsRow}>
                        <TouchableOpacity
                          style={styles.viewDetailsButton}
                          activeOpacity={0.75}
                          onPress={() => setDetailsRequest(request)}
                        >
                          <Text style={styles.viewDetailsText}>View Details</Text>
                        </TouchableOpacity>

                        {isRequestPending && (
                          <TouchableOpacity
                            style={[
                              styles.cancelRequestButton,
                              cancellingRequestId === request.id &&
                                styles.actionButtonDisabled,
                            ]}
                            activeOpacity={0.85}
                            onPress={() => confirmCancelRequest(request)}
                            disabled={cancellingRequestId === request.id}
                          >
                            <Text style={styles.cancelRequestText}>
                              {cancellingRequestId === request.id
                                ? 'Cancelling...'
                                : 'Cancel Request'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>

          </ScrollView>

        </View>

        <Modal visible={!!requestToCancel} transparent animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Cancel Request</Text>
              <Text style={styles.modalMessage}>
                Are you sure you want to cancel this pending request?
                {'\n\n'}
                This action cannot be undone.
              </Text>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalSecondaryButton}
                  onPress={closeCancelModal}
                  disabled={!!cancellingRequestId}
                >
                  <Text style={styles.modalSecondaryButtonText}>No</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalPrimaryButton,
                    !!cancellingRequestId && styles.modalButtonDisabled,
                  ]}
                  onPress={proceedWithCancelRequest}
                  disabled={!!cancellingRequestId}
                >
                  <Text style={styles.modalPrimaryButtonText}>Yes, Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <RequestDetailsModal
          visible={!!detailsRequest}
          onClose={() => setDetailsRequest(null)}
          request={detailsRequestData}
        />

        <Modal visible={!!notification} transparent animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>{notification?.title}</Text>
              <Text style={styles.modalMessage}>{notification?.message}</Text>

              <TouchableOpacity
                style={styles.modalFullButton}
                onPress={() => setNotification(null)}
              >
                <Text style={styles.modalPrimaryButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 34,
    paddingTop: 0,
    paddingBottom: 148,
  },
  welcomeSection: {
    marginTop: 18,
  },
  welcomeText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  greetingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  dateText: {
    color: '#E3F2FD',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  productsSection: {
    marginTop: 24,
  },
  productCarousel: {
    alignSelf: 'flex-start',
  },
  productCarouselItem: {
    width: '100%',
    height: '100%',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  productStateCard: {
    minHeight: 146,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...createShadow({
      color: '#000',
      elevation: 6,
      opacity: 0.12,
      radius: 10,
      offset: { width: 0, height: 5 },
    }),
  },
  productCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    position: 'relative',
    justifyContent: 'space-between',
    ...createShadow({
      color: '#000',
      elevation: 6,
      opacity: 0.13,
      radius: 9,
      offset: { width: 0, height: 5 },
    }),
  },
  priceBadge: {
    position: 'absolute',
    top: 12,
    left: 14,
    backgroundColor: '#187BCD',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    zIndex: 1,
  },
  priceBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 14,
    fontWeight: 'bold',
  },
  productImageWrap: {
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  productImage: {
    width: 96,
    height: 96,
  },
  productDetails: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  productName: {
    color: '#187BCD',
    fontSize: 15,
    lineHeight: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  productGallons: {
    color: '#455A64',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
    marginTop: 3,
    textAlign: 'center',
  },
  productStock: {
    color: '#2E7D32',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  productStockUnavailable: {
    color: '#D32F2F',
  },
  orderButton: {
    height: 32,
    backgroundColor: '#187BCD',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  orderButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  paginationDots: {
    minHeight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    width: 22,
    backgroundColor: '#FFFFFF',
  },
  currentRequestSection: {
    marginTop: 8,
  },
  currentRequestLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  currentRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 15,
    position: 'relative',
    ...createShadow({
      color: '#0D47A1',
      elevation: 6,
      opacity: 0.12,
      radius: 10,
      offset: { width: 0, height: 5 },
    }),
  },
  currentRequestCardGap: {
    marginTop: 12,
  },
  requestCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: BLUE_LIGHT,
  },
  requestId: {
    flex: 1,
    color: BLUE,
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  requestDetailsGrid: {
    paddingTop: 13,
  },
  requestInfoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  requestInfoRowSpaced: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BLUE_LIGHT,
  },
  requestInfoBlock: {
    flex: 1,
  },
  requestInfoLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  requestInfoPrimaryValue: {
    color: BLUE,
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  requestInfoValue: {
    color: TEXT_DARK,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 15,
  },
  viewDetailsButton: {
    flex: 1,
    minHeight: 42,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#2563EB',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  viewDetailsText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  cancelRequestButton: {
    flex: 1,
    minHeight: 42,
    backgroundColor: '#EF4444',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    ...createShadow({
      color: '#EF4444',
      elevation: 4,
      opacity: 0.18,
      radius: 10,
      offset: { width: 0, height: 4 },
    }),
  },
  cancelRequestText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  emptyRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 16,
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 4 },
    }),
  },
  emptyRequestTitle: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyRequestText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 14,
    textAlign: 'center',
  },
  modalMessage: {
    width: '100%',
    color: '#455A64',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActions: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalSecondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#187BCD',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  modalSecondaryButtonText: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalPrimaryButton: {
    flex: 1,
    backgroundColor: '#187BCD',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  modalFullButton: {
    width: '100%',
    backgroundColor: '#187BCD',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  modalPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalButtonDisabled: {
    opacity: 0.7,
  },
});
