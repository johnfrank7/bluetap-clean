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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Carousel from 'react-native-reanimated-carousel';
import { auth } from '../../firebase';
import { getLocalUsers } from '../../localUsers';
import { subscribeProducts } from '../../services/products';
import { cancelRequest, subscribeRequesterRequests } from '../../services/requests';

const PHONE_MAX_WIDTH = 375;
const DASHBOARD_HORIZONTAL_PADDING = 34;
const PRODUCT_CARD_WIDTH_RATIO = 0.88;
const PRODUCT_CAROUSEL_HEIGHT = 226;
const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;
const getRequestProductSummary = (request) => {
  if (!request) return '4 Gallons';

  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items
      .map((item) => `${item.quantity} ${item.product_name}`)
      .join(', ');
  }

  return `${request.quantity} ${request.product_name}`;
};
const inactiveStatuses = ['delivered', 'cancelled', 'canceled'];
const getNormalizedStatus = (status) =>
  (status || '').toString().trim().toLowerCase();
const isActiveRequest = (request) =>
  !inactiveStatuses.includes(getNormalizedStatus(request.status));
const isPendingRequest = (request) =>
  getNormalizedStatus(request.status) === 'pending';
const getProductGallons = (product) =>
  product.capacity ||
  product.gallons ||
  product.gallon ||
  product.volume ||
  product.size ||
  product.product_name ||
  '';
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
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [currentRequests, setCurrentRequests] = useState([]);
  const [cancellingRequestId, setCancellingRequestId] = useState('');
  const [openRequestMenuId, setOpenRequestMenuId] = useState('');
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
    const requesterId =
      auth.currentUser?.uid ||
      getLocalUsers().find((localUser) => localUser.role === 'requester')?.uid ||
      '';

    if (!requesterId) return undefined;

    return subscribeRequesterRequests(requesterId, (requests) => {
      setCurrentRequests(requests.filter(isActiveRequest));
    });
  }, []);

  const cancelPendingRequest = async (request) => {
    if (cancellingRequestId) return;

    try {
      setCancellingRequestId(request.id);
      await cancelRequest(request);
      Alert.alert('Request cancelled', 'Your pending request has been cancelled.');
    } catch (error) {
      if (error.savedLocal) {
        Alert.alert(
          'Saved locally',
          'Your request was cancelled on this device, but Firebase did not accept the update.'
        );
        return;
      }

      Alert.alert('Cancel failed', error.message);
    } finally {
      setCancellingRequestId('');
    }
  };

  const confirmCancelRequest = (request) => {
    setOpenRequestMenuId('');

    if (globalThis.confirm) {
      if (globalThis.confirm('Cancel this pending request?')) {
        cancelPendingRequest(request);
      }
      return;
    }

    Alert.alert(
      'Cancel request',
      'Cancel this pending request?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () => cancelPendingRequest(request),
        },
      ]
    );
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
              <Text style={styles.productGallons} numberOfLines={1}>
                {getProductGallons(product)}
              </Text>
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

  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={styles.header}>
              <Text style={styles.appName}>BlueTap</Text>
              <Image
                source={require('../../assets/icons/bluetapwhitelogo.png')}
                style={styles.logo}
              />
            </View>

            <View style={styles.welcomeSection}>
              <Text style={styles.welcomeText}>WELCOME!</Text>
              <Text style={styles.subText}>Need mineral water?</Text>
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
                <View style={styles.card}>
                  <Text style={styles.cardText}>No current request.</Text>
                </View>
              ) : (
                currentRequests.map((request, index) => (
                  <View
                    style={[styles.card, index > 0 && styles.currentRequestCardGap]}
                    key={request.id}
                  >
                    {isPendingRequest(request) && (
                      <View style={styles.requestMenuWrap}>
                        <TouchableOpacity
                          style={styles.requestMenuButton}
                          onPress={() =>
                            setOpenRequestMenuId((currentId) =>
                              currentId === request.id ? '' : request.id
                            )
                          }
                          disabled={cancellingRequestId === request.id}
                        >
                          <Text style={styles.requestMenuDots}>...</Text>
                        </TouchableOpacity>

                        {openRequestMenuId === request.id && (
                          <View style={styles.requestMenu}>
                            <TouchableOpacity
                              style={styles.requestMenuItem}
                              onPress={() => confirmCancelRequest(request)}
                              disabled={cancellingRequestId === request.id}
                            >
                              <Text style={styles.requestMenuItemText}>
                                {cancellingRequestId === request.id
                                  ? 'Cancelling...'
                                  : 'Cancel request'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    <Text style={styles.cardText}>
                      Request ID: {request.request_id || request.id}
                    </Text>
                    <Text style={styles.cardText}>
                      Quantity: {getRequestProductSummary(request)}
                    </Text>
                    <Text style={styles.cardText}>
                      Container: {request.container || 'Not set'}
                    </Text>
                    <Text style={styles.cardText}>
                      {request.water_station || 'Water station not set'}
                    </Text>

                    <Text style={styles.status}>
                      Status: {request.status || 'Pending'}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <View style={{ height: 200 }} />

          </ScrollView>

          <View style={styles.bottomNav}>
            <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
              <Image
                source={require('../../assets/icons/home.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/requester/r_request')}>
              <Image
                source={require('../../assets/icons/square-plus.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
              <Image
                source={require('../../assets/icons/user.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>
          </View>

        </View>
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
    paddingTop: 56,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  logo: {
    width: 30,
    height: 30,
    tintColor: '#FFFFFF',
  },
  welcomeSection: {
    marginTop: 32,
  },
  welcomeText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  subText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 5,
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
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
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
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.13,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
  },
  priceBadge: {
    position: 'absolute',
    top: 12,
    left: 14,
    backgroundColor: '#187BCD',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
  priceBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
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
    marginTop: 10,
  },
  currentRequestLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    paddingRight: 48,
    position: 'relative',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  currentRequestCardGap: {
    marginTop: 10,
  },
  cardText: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 6,
  },
  status: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
  },
  requestMenuWrap: {
    position: 'absolute',
    top: 8,
    right: 10,
    zIndex: 3,
    alignItems: 'flex-end',
  },
  requestMenuButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestMenuDots: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  requestMenu: {
    minWidth: 126,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BBDEFB',
    borderRadius: 8,
    paddingVertical: 4,
    marginTop: 2,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  requestMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requestMenuItemText: {
    color: '#187BCD',
    fontSize: 12,
    fontWeight: 'bold',
  },

  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 34,
    right: 34,

    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',

    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,

    zIndex: 2,

    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },

  navIcon: {
    width: 26,
    height: 26,
    tintColor: '#187BCD',
  },
});
