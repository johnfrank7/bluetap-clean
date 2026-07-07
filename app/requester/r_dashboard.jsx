import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { auth } from '../../firebase';
import { getLocalUsers } from '../../localUsers';
import { subscribeProducts } from '../../services/products';
import { cancelRequest, subscribeRequesterRequests } from '../../services/requests';

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

export default function RequesterDashboard() {
  const router = useRouter(); 
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [currentRequests, setCurrentRequests] = useState([]);
  const [cancellingRequestId, setCancellingRequestId] = useState('');

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
                <View style={styles.productsGrid}>
                  <View style={[styles.productTile, styles.productTileEmpty]}>
                    <ActivityIndicator size="small" color="#187BCD" />
                  </View>
                </View>
              ) : products.length === 0 ? (
                <View style={styles.productsGrid}>
                  <View style={[styles.productTile, styles.productTileEmpty]}>
                    <Text style={styles.productName}>No products available.</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.productsGrid}>
                  {products.map((product) => (
                    <TouchableOpacity
                      style={styles.productTile}
                      key={product.id}
                      activeOpacity={0.85}
                      onPress={() =>
                        router.push({
                          pathname: '/requester/requestform',
                          params: { productId: product.id },
                        })
                      }
                    >
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
                        {!!product.capacity && (
                          <Text style={styles.productSubtext} numberOfLines={1}>
                            {product.capacity}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
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

                    {isPendingRequest(request) && (
                      <TouchableOpacity
                        style={[
                          styles.cancelRequestButton,
                          cancellingRequestId === request.id && styles.buttonDisabled,
                        ]}
                        onPress={() => confirmCancelRequest(request)}
                        disabled={cancellingRequestId === request.id}
                      >
                        <Text style={styles.cancelRequestText}>
                          {cancellingRequestId === request.id
                            ? 'Cancelling...'
                            : 'Cancel request'}
                        </Text>
                      </TouchableOpacity>
                    )}
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
    marginTop: 36,
  },
  productsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  productTile: {
    width: '48%',
    minHeight: 170,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 12,
    marginBottom: 18,
    position: 'relative',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  productTileEmpty: {
    width: '100%',
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceBadge: {
    position: 'absolute',
    top: 9,
    left: 9,
    backgroundColor: '#187BCD',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    zIndex: 1,
  },
  priceBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  productImageWrap: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  productImage: {
    width: 88,
    height: 94,
  },
  productDetails: {
    marginTop: 8,
  },
  productName: {
    color: '#187BCD',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: 'bold',
  },
  productSubtext: {
    color: '#187BCD',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: 'bold',
    marginTop: 1,
  },
  currentRequestSection: {
    marginTop: 18,
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
  cancelRequestButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#187BCD',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  cancelRequestText: {
    color: '#187BCD',
    fontSize: 12,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.7,
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
