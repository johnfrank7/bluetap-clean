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
import ProductCard from '../../components/ProductCard';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import PortalSwipeContainer, { REQUESTER_TABS } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import { normalizeRequesterOrderStatus } from '../../constants/requesterOrderStatus';
import { getActiveProducts } from '../../services/requesterOrdering';
import {
  cancelRequest,
  refreshRequesterRequests,
  subscribeRequesterCurrentRequests,
} from '../../services/requests';

const REQUESTER_APP_MAX_WIDTH = USER_PORTAL_LAYOUT.maxWidth;
const DASHBOARD_HORIZONTAL_PADDING = USER_PORTAL_LAYOUT.gutter;
const PRODUCT_CARD_WIDTH_RATIO = 0.88;
const PRODUCT_CAROUSEL_HEIGHT = 325;
const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;
const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;
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
const isPendingRequest = (request) =>
  ['pending', 'outside radius pending approval'].includes(
    normalizeRequesterOrderStatus(request?.status)
  );
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

function TypewriterGreeting({ text, style }) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    let i = 0;
    setDisplayed('');
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, 35);
    return () => clearInterval(timer);
  }, [text]);

  return <Text style={style}>{displayed || text}</Text>;
}

export default function RequesterDashboard() {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter(); 
  const productCarouselRef = useRef(null);
  const { width: windowWidth } = useWindowDimensions();
  const todayText = formatDashboardDate(new Date());
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [viewAllModalVisible, setViewAllModalVisible] = useState(false);
  const [currentRequests, setCurrentRequests] = useState([]);
  const [currentRequestsLoading, setCurrentRequestsLoading] = useState(true);
  const [currentRequestsError, setCurrentRequestsError] = useState('');
  const [cancellingRequestId, setCancellingRequestId] = useState('');
  const [requestToCancel, setRequestToCancel] = useState(null);
  const [detailsRequest, setDetailsRequest] = useState(null);
  const [notification, setNotification] = useState(null);
  const [requesterName, setRequesterName] = useState('Requester');
  const productCarouselWidth = Math.max(
    1,
    Math.min(windowWidth, REQUESTER_APP_MAX_WIDTH) -
      DASHBOARD_HORIZONTAL_PADDING * 2
  );
  const productCarouselItemWidth = Math.max(
    1,
    Math.round(productCarouselWidth * PRODUCT_CARD_WIDTH_RATIO)
  );
  const productCarouselSideInset =
    (productCarouselWidth - productCarouselItemWidth) / 2;

  const loadProducts = useCallback(async (force = false) => {
    setProductsLoading(true);
    setProductsError('');
    try {
      setProducts(await getActiveProducts({ force }));
    } catch (error) {
      setProducts([]);
      setProductsError(error?.message || 'Unable to load products right now.');
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (mounted) {
          setProducts([]);
          setProductsLoading(false);
          setProductsError('Requester authentication is required.');
        }
        return;
      }

      getActiveProducts({ force: true })
        .then((nextProducts) => {
          if (mounted) setProducts(nextProducts);
        })
        .catch((error) => {
          if (mounted) {
            setProducts([]);
            setProductsError(error?.message || 'Unable to load products right now.');
          }
        })
        .finally(() => {
          if (mounted) setProductsLoading(false);
        });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
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
      return user?.uid || '';
    };

    const subscribeForRequester = (requesterId) => {
      const normalizedRequesterId = (requesterId || '').toString().trim();

      if (normalizedRequesterId === activeRequesterId) return;

      unsubscribeRequests();
      activeRequesterId = normalizedRequesterId;

      if (!normalizedRequesterId) {
        setCurrentRequests([]);
        setCurrentRequestsLoading(false);
        setCurrentRequestsError('Requester authentication is required.');
        return;
      }

      setCurrentRequestsLoading(true);
      setCurrentRequestsError('');
      unsubscribeRequests = subscribeRequesterCurrentRequests(
        normalizedRequesterId,
        (nextRequests) => {
          setCurrentRequests(nextRequests);
          setCurrentRequestsLoading(false);
        },
        (error) => {
          setCurrentRequestsError(error?.message || 'Unable to load current orders right now.');
          setCurrentRequestsLoading(false);
        }
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const localRequester = user ? findLocalUserForAuthRole(user, 'requester') : null;
      const displayName = localRequester?.fullName || localRequester?.firstName || user?.displayName || 'Requester';
      setRequesterName(String(displayName).trim().split(/\s+/)[0] || 'Requester');
      subscribeForRequester(getRequesterId(user));
    });

    return () => {
      unsubscribeAuth();
      unsubscribeRequests();
    };
  }, []);

  const retryCurrentRequests = () => {
    const requesterId = auth.currentUser?.uid;
    if (!requesterId) return;
    setCurrentRequestsError('');
    setCurrentRequestsLoading(true);
    refreshRequesterRequests(requesterId);
  };

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
    ({ item: product }) => (
      <View style={styles.productCarouselItem}>
        <ProductCard product={product} compact onOrder={() => openProductRequest(product.id)} />
      </View>
    ),
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
        requesterName: detailsRequest.requester_name || 'Not set',
        requesterUniqueId:
          detailsRequest.requester_unique_id ||
          findLocalUserForAuthRole(auth.currentUser, 'requester')?.unique_id ||
          '',
        customerName: detailsRequest.requester_name || 'Not set',
        distributorName: detailsRequest.distributor_name || '',
        distributorUniqueId: detailsRequest.distributor_unique_id || '',
        contactNumber: detailsRequest.contact_number || 'Not set',
        deliveryAddress: detailsRequest.address || 'Not set',
        items: getRequestItems(detailsRequest),
        grandTotalAmount: getRequestTotalAmount(detailsRequest),
      }
    : null;

  return (
    <LinearGradient
      colors={isDark ? [colors.background, colors.header] : [colors.primary, colors.primaryLight]}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        <StatusBar style="light" />

        <PortalSwipeContainer tabs={REQUESTER_TABS} currentRoute="/requester/r_dashboard">
        <View style={styles.phoneWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={styles.welcomeSection}>
              <Text style={[styles.welcomeText, isDark && { color: colors.textPrimary }]}>WELCOME!</Text>
              <TypewriterGreeting
                text={`Good Morning, ${requesterName}`}
                style={[styles.greetingText, isDark && { color: colors.textPrimary }]}
              />
              <Text style={[styles.dateText, isDark && { color: colors.muted }]}>{todayText}</Text>
            </View>

            <View style={styles.productsSection}>
              {productsLoading ? (
                <View style={styles.productStateCard}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : products.length === 0 ? (
                <View style={styles.productStateCard}>
                  <Text style={styles.productName}>{productsError || 'No products available.'}</Text>
                  {!!productsError && (
                    <TouchableOpacity accessibilityRole="button" onPress={() => loadProducts(true)} style={styles.catalogRetry}>
                      <Text style={styles.catalogRetryText}>Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <>
                  <Carousel
                    ref={productCarouselRef}
                    data={products}
                    loop={products.length > 1}
                    autoPlay={products.length > 1}
                    autoPlayInterval={4000}
                    style={[
                      styles.productCarousel,
                      {
                        width: productCarouselWidth,
                        height: PRODUCT_CAROUSEL_HEIGHT,
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

                  <View style={styles.viewAllProductsRow}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="View All Products"
                      onPress={() => setViewAllModalVisible(true)}
                      style={styles.viewAllProductsBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.viewAllProductsText}>View All Products ({products.length})</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            <View style={styles.currentRequestSection}>
              <Text style={styles.currentRequestLabel}>Current Request</Text>

              {currentRequestsLoading ? (
                <View style={styles.emptyRequestCard}>
                  <ActivityIndicator size="small" color={BLUE} />
                  <Text style={styles.emptyRequestText}>Loading current order...</Text>
                </View>
              ) : currentRequestsError ? (
                <View style={styles.emptyRequestCard}>
                  <Text style={styles.emptyRequestTitle}>Current order unavailable</Text>
                  <Text style={styles.emptyRequestText}>{currentRequestsError}</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={retryCurrentRequests} style={styles.catalogRetry}>
                    <Text style={styles.catalogRetryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : currentRequests.length === 0 ? (
                <BlueTapEmptyState
                  title="No Current Request"
                  description="Your active orders will appear here once you place a request."
                  actionLabel="Place an Order"
                  onAction={() => router.push('/requester/requestform')}
                  compact
                />
              ) : (
                currentRequests.slice(0, 1).map((request, index) => {
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
        </PortalSwipeContainer>

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

        <Modal
          visible={viewAllModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setViewAllModalVisible(false)}
        >
          <View style={styles.allProductsModalBackdrop}>
            <View style={styles.allProductsModalCard}>
              <View style={styles.allProductsModalHeader}>
                <View>
                  <Text style={styles.allProductsModalTitle}>All Products</Text>
                  <Text style={styles.allProductsModalSubtitle}>Available branch catalog</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={() => setViewAllModalVisible(false)}
                  style={styles.allProductsCloseBtn}
                >
                  <Text style={styles.allProductsCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.allProductsList} showsVerticalScrollIndicator={false}>
                {products.map((item) => (
                  <View key={item.id} style={styles.allProductsItemWrapper}>
                    <ProductCard
                      product={item}
                      compact={false}
                      onOrder={(prod) => {
                        setViewAllModalVisible(false);
                        router.push({
                          pathname: '/requester/requestform',
                          params: { productId: prod.id },
                        });
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = createPortalStyleSheet({
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
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: DASHBOARD_HORIZONTAL_PADDING,
    paddingTop: 20,
    paddingBottom: USER_PORTAL_BOTTOM_CONTENT_INSET,
  },
  welcomeSection: {
    marginTop: 0,
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
    marginTop: 20,
  },
  productCarousel: {
    alignSelf: 'flex-start',
  },
  productCarouselItem: {
    width: '100%',
    height: '100%',
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productStateCard: {
    minHeight: 146,
    backgroundColor: '#FFFFFF',
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
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
  catalogRetry: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BLUE,
    borderRadius: 9,
  },
  catalogRetryText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: '900',
  },
  productCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
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
    marginTop: 16,
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
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    padding: 16,
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
    marginTop: 14,
  },
  requestCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 12,
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
    paddingTop: 12,
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
    marginTop: 16,
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
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
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
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
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
  viewAllProductsRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  viewAllProductsBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  viewAllProductsText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  allProductsModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  allProductsModalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    ...createShadow({
      color: '#000',
      elevation: 10,
      opacity: 0.2,
      radius: 16,
      offset: { width: 0, height: 8 },
    }),
  },
  allProductsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  allProductsModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  allProductsModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  allProductsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  allProductsCloseText: {
    fontSize: 20,
    color: '#475569',
    lineHeight: 22,
    fontWeight: '700',
  },
  allProductsList: {
    paddingBottom: 16,
    gap: 16,
  },
  allProductsItemWrapper: {
    alignItems: 'center',
  },
});
