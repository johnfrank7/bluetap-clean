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
import { useRequesterData } from '../../components/RoleDataProviders';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { createShadow } from '../../components/shadowStyles';
import ProductCard from '../../components/ProductCard';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import LocalTimeCard from '../../components/LocalTimeCard';
import PortalSwipeContainer, { PortalSwipeIgnore, REQUESTER_TABS } from '../../components/PortalSwipeContainer';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { useReducedMotionPreference } from '../../components/BlueTapThemeTransition';
import { RequesterOrderChatActions } from '../../components/chat/ChatOrderActions';
import { ModerationNoticeBanner } from '../../components/ModerationNotices';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';
import {
  isCancellableRequesterOrderStatus,
  normalizeRequesterOrderStatus,
} from '../../constants/requesterOrderStatus';
import { getActiveProducts, getCachedActiveProducts } from '../../services/requesterOrdering';
import { useLiveGreeting } from '../../services/liveTime';
import {
  cancelRequest,
  refreshRequesterRequests,
  isCurrentRequesterRequest,
} from '../../services/requests';

const REQUESTER_APP_MAX_WIDTH = USER_PORTAL_LAYOUT.maxWidth;
const DASHBOARD_HORIZONTAL_PADDING = USER_PORTAL_LAYOUT.gutter;
const PRODUCT_CARD_WIDTH_RATIO = 0.88;
const PRODUCT_CAROUSEL_HEIGHT = 368;
const BLUE = BLUETAP_COLORS.primary;
const BLUE_LIGHT = BLUETAP_COLORS.primarySoft;
const CARD_BORDER = BLUETAP_COLORS.border;
const TEXT_MUTED = BLUETAP_COLORS.textSecondary;
const TEXT_DARK = BLUETAP_COLORS.textPrimary;
const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;
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
  isCancellableRequesterOrderStatus(request?.status);
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

const GREETING_TYPING_SPEED = 65;
const GREETING_BACKSPACING_SPEED = 25;
const GREETING_DEFAULT_HOLD = 5000;
const GREETING_PROMO_HOLD = 3000;
const GREETING_ERASE_PAUSE = 250;
const GREETING_CURSOR_BLINK_INTERVAL = 500;

const GREETING_PROMO_PHRASES = [
  'Need water? Order now!',
  'Fresh water, one tap away!',
];

function TypewriterGreeting({ text, style }) {
  const { colors, isDark } = useBlueTapTheme();
  const reduceMotion = useReducedMotionPreference();
  const textRef = useRef(text);
  textRef.current = text;

  const [displayed, setDisplayed] = useState(() => (reduceMotion ? text : ''));
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    if (reduceMotion) {
      setDisplayed(text);
      setCursorVisible(false);
      return;
    }

    let isMounted = true;
    let timeoutId = null;
    let blinkIntervalId = null;

    let phraseIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    const stopBlinking = () => {
      if (blinkIntervalId) {
        clearInterval(blinkIntervalId);
        blinkIntervalId = null;
      }
      if (isMounted) {
        setCursorVisible(true);
      }
    };

    const startBlinking = () => {
      stopBlinking();
      blinkIntervalId = setInterval(() => {
        setCursorVisible((prev) => !prev);
      }, GREETING_CURSOR_BLINK_INTERVAL);
    };

    const getPhrase = (index) => {
      if (index === 0) {
        return textRef.current || 'Welcome!';
      }
      return GREETING_PROMO_PHRASES[index - 1] || textRef.current || 'Welcome!';
    };

    const getHoldDuration = (index) => {
      return index === 0 ? GREETING_DEFAULT_HOLD : GREETING_PROMO_HOLD;
    };

    const schedule = (callback, delay) => {
      if (!isMounted) return;
      timeoutId = setTimeout(callback, delay);
    };

    const tick = () => {
      if (!isMounted) return;

      const currentPhrase = getPhrase(phraseIndex);

      if (!isDeleting) {
        charIndex++;
        setDisplayed(currentPhrase.slice(0, charIndex));

        if (charIndex >= currentPhrase.length) {
          isDeleting = true;
          startBlinking();
          schedule(tick, getHoldDuration(phraseIndex));
          return;
        }

        schedule(tick, GREETING_TYPING_SPEED);
      } else {
        if (blinkIntervalId) {
          stopBlinking();
        }
        charIndex--;
        setDisplayed(currentPhrase.slice(0, Math.max(0, charIndex)));

        if (charIndex <= 0) {
          isDeleting = false;
          charIndex = 0;
          phraseIndex = (phraseIndex + 1) % 3;
          schedule(tick, GREETING_ERASE_PAUSE);
          return;
        }

        schedule(tick, GREETING_BACKSPACING_SPEED);
      }
    };

    stopBlinking();
    schedule(tick, 150);

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (blinkIntervalId) {
        clearInterval(blinkIntervalId);
      }
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      setDisplayed(text);
      setCursorVisible(false);
    }
  }, [reduceMotion, text]);

  return (
    <View style={styles.greetingWrapper} accessible accessibilityLabel={text}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={style}
      >
        {reduceMotion ? text : displayed}
        {!reduceMotion && (
          <Text
            style={[
              styles.greetingCursor,
              isDark && { color: colors.primaryLight || '#70BDF2' },
              !cursorVisible && styles.greetingCursorHidden,
            ]}
          >
            |
          </Text>
        )}
      </Text>
    </View>
  );
}

export default function RequesterDashboard() {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter(); 
  const productCarouselRef = useRef(null);
  const { width: windowWidth } = useWindowDimensions();
  const liveGreeting = useLiveGreeting();
  const [products, setProducts] = useState(() => getCachedActiveProducts() || []);
  const [productsLoading, setProductsLoading] = useState(() => !(getCachedActiveProducts()?.length > 0));
  const [productsError, setProductsError] = useState('');
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [viewAllModalVisible, setViewAllModalVisible] = useState(false);
  const [currentRequests, setCurrentRequests] = useState([]);
  const [currentRequestsLoading, setCurrentRequestsLoading] = useState(true);
  const [currentRequestsError, setCurrentRequestsError] = useState('');
  const requesterData = useRequesterData();
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
    if (force || !products.length) {
      setProductsLoading(true);
    }
    setProductsError('');
    try {
      const nextProducts = force
        ? await getActiveProducts({ force: true })
        : await getActiveProducts();
      setProducts(nextProducts);
      setProductsError('');
    } catch (error) {
      if (force || !products.length) {
        setProducts([]);
        setProductsError(error?.message || 'Unable to load products right now.');
      }
    } finally {
      setProductsLoading(false);
    }
  }, [products.length]);

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

      const cached = getCachedActiveProducts();
      if (cached && cached.length > 0) {
        if (mounted) {
          setProducts(cached);
          setProductsLoading(false);
        }
      } else {
        if (mounted) setProductsLoading(true);
      }

      getActiveProducts()
        .then((nextProducts) => {
          if (mounted) {
            setProducts(nextProducts);
            setProductsError('');
          }
        })
        .catch((error) => {
          if (mounted) {
            setProducts((current) => {
              if (!current || current.length === 0) {
                setProductsError(error?.message || 'Unable to load products right now.');
                return [];
              }
              return current;
            });
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
    setCurrentRequests(requesterData.orders.filter(isCurrentRequesterRequest));
    setCurrentRequestsLoading(requesterData.loading);
    setCurrentRequestsError(requesterData.error);
    setRequesterName(String(requesterData.profile?.fullName || 'Requester').trim().split(/\s+/)[0]);
  }, [requesterData.orders, requesterData.loading, requesterData.error, requesterData.profile]);

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
  const liveDetailsRequest = detailsRequest
    ? requesterData.orders.find((request) => request.id === detailsRequest.id) || null
    : null;
  const detailsRequestData = liveDetailsRequest
    ? {
        requestId: liveDetailsRequest.request_id || liveDetailsRequest.id,
        status: liveDetailsRequest.status || 'Pending',
        orderDate: formatRequestDate(liveDetailsRequest.created_at),
        deliveryDate: formatRequestDate(liveDetailsRequest.delivery_date),
        product: getCardProductSummary(liveDetailsRequest),
        containerType: liveDetailsRequest.container || 'Not set',
        quantity: getRequestQuantityText(liveDetailsRequest),
        totalAmount: getRequestTotalAmount(liveDetailsRequest),
        waterStation: liveDetailsRequest.water_station || 'Not set',
        paymentMethod:
          liveDetailsRequest.payment_method ||
          liveDetailsRequest.paymentMethod ||
          'cash_on_delivery',
        requesterName: liveDetailsRequest.requesterNameSnapshot || liveDetailsRequest.requester_name || 'Not set',
        requesterUniqueId:
          liveDetailsRequest.requesterUniqueIdSnapshot ||
          liveDetailsRequest.requester_unique_id ||
          findLocalUserForAuthRole(auth.currentUser, 'requester')?.unique_id ||
          '',
        customerName: liveDetailsRequest.requesterNameSnapshot || liveDetailsRequest.requester_name || 'Not set',
        distributorName: liveDetailsRequest.distributorNameSnapshot || liveDetailsRequest.distributor_name || '',
        distributorUniqueId: liveDetailsRequest.distributorPublicUidSnapshot || liveDetailsRequest.distributor_unique_id || '',
        contactNumber: liveDetailsRequest.contactNumberSnapshot || liveDetailsRequest.contact_number || 'Not set',
        deliveryAddress: liveDetailsRequest.addressSnapshot || liveDetailsRequest.address || 'Not set',
        deliveryLocation: liveDetailsRequest.deliveryLocation,
        branchLocation: liveDetailsRequest.branchLocation,
        branchId: liveDetailsRequest.currentBranchId || liveDetailsRequest.branchId,
        items: getRequestItems(liveDetailsRequest),
        subtotalAtOrder: liveDetailsRequest.subtotalAtOrder,
        deliveryFeeAtOrder: liveDetailsRequest.deliveryFeeAtOrder,
        grandTotalAmount: getRequestTotalAmount(liveDetailsRequest),
        failureReason: liveDetailsRequest.failureReason,
        failureReasonCode: liveDetailsRequest.failureReasonCode,
        failureReasonLabel: liveDetailsRequest.failureReasonLabel,
        failureReasonNote: liveDetailsRequest.failureReasonNote,
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

            <View style={styles.welcomeRow}>
              <View style={styles.welcomeSection}>
                <Text style={[styles.welcomeText, isDark && { color: colors.textPrimary }]}>WELCOME!</Text>
                <TypewriterGreeting
                  text={`${liveGreeting}, ${requesterName}!`}
                  style={[styles.greetingText, isDark && { color: colors.textPrimary }]}
                />
              </View>
              <LocalTimeCard compact={windowWidth < 430} onBrand={!isDark} />
            </View>
            <ModerationNoticeBanner />

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
                  <PortalSwipeIgnore>
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
                </PortalSwipeIgnore>

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
                      <RequesterOrderChatActions order={request} compact />
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
          branches={requesterData.branches}
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
            <View style={[styles.allProductsModalCard, isDark && { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 }]}>
              <View style={[styles.allProductsModalHeader, isDark && { borderBottomColor: colors.border }]}>
                <View>
                  <Text style={[styles.allProductsModalTitle, isDark && { color: colors.textPrimary }]}>All Products</Text>
                  <Text style={[styles.allProductsModalSubtitle, isDark && { color: colors.textSecondary }]}>Available branch catalog</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={() => setViewAllModalVisible(false)}
                  style={[styles.allProductsCloseBtn, isDark && { backgroundColor: colors.surface }]}
                >
                  <Text style={[styles.allProductsCloseText, isDark && { color: colors.textPrimary }]}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.allProductsList}
                contentContainerStyle={styles.allProductsContentContainer}
                showsVerticalScrollIndicator={false}
              >
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
  welcomeRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  welcomeSection: {
    marginTop: 0,
    flex: 1,
    minWidth: 0,
  },
  welcomeText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  greetingWrapper: {
    minHeight: 22,
    justifyContent: 'center',
    marginTop: 4,
  },
  greetingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  greetingCursor: {
    color: '#FFFFFF',
    fontWeight: '300',
    marginLeft: 2,
    opacity: 1,
  },
  greetingCursorHidden: {
    opacity: 0,
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
    paddingVertical: 6,
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
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  viewDetailsButton: {
    flexGrow: 1,
    flexBasis: 118,
    minWidth: 0,
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
    flexGrow: 1,
    flexBasis: 118,
    minWidth: 0,
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
    marginTop: 14,
    paddingTop: 4,
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
    maxWidth: 400,
    maxHeight: '85%',
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
    borderBottomColor: '#D7ECFF',
  },
  allProductsModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#12304A',
  },
  allProductsModalSubtitle: {
    fontSize: 12,
    color: '#455A64',
    marginTop: 2,
  },
  allProductsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF3F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  allProductsCloseText: {
    fontSize: 20,
    color: '#455A64',
    lineHeight: 22,
    fontWeight: '700',
  },
  allProductsList: {
    width: '100%',
    flexGrow: 1,
  },
  allProductsContentContainer: {
    paddingTop: 6,
    paddingBottom: 24,
    paddingHorizontal: 4,
    gap: 18,
  },
  allProductsItemWrapper: {
    width: '100%',
    alignItems: 'center',
  },
});
