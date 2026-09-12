import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';
import { getLocalRequests } from '../../services/requests';
import { getProfileUniqueId } from '../../services/uniqueIds';
import ManagerShell, {
  MANAGER_COLORS,
  ManagerPill,
  ManagerWaterDrop,
} from '../../components/ManagerShell';
import {
  formatManagerNumber,
  useAnimatedNumber,
  useAnimatedValueSnapshot,
  useReducedMotionPreference,
} from '../../components/managerAnimationHooks';

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

const getDistributorApplicationStatus = (distributor) =>
  normalizeApplicationStatus(
    distributor.status ||
      distributor.approvalStatus ||
      distributor.accountStatus ||
      'pending'
  );

const getRegisteredLocalDistributors = (firestoreDistributors = []) =>
  getLocalUsers()
    .filter(
      (user) =>
        normalizeRole(user.role) === 'distributor' &&
        getDistributorApplicationStatus(user) === 'approved'
    )
    .map((user) => ({ ...user, id: user.uid, isLocal: true }))
    .filter(
      (localUser) =>
        !firestoreDistributors.some(
          (firestoreUser) =>
            firestoreUser.uid === localUser.uid ||
            firestoreUser.email === localUser.email
        )
    );

const defaultStations = ['aquabea', 'bluetap'];
const BLUE_DARK = '#0D47A1';
const BLUE = '#187BCD';
const BLUE_MID = '#42A5F5';
const BLUE_LIGHT = '#E3F2FD';
const LINE_THICKNESS = 3;
const BARANGAY_DONUT_LIMIT = 8;

const getRequestQuantity = (request) => {
  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  }

  return Number(request.quantity || 0);
};

const mergeByIdentity = (items) => {
  const itemMap = new Map();

  items.forEach((item) => {
    const key = item.uid || item.id || item.email;
    if (key) {
      itemMap.set(key, item);
    }
  });

  return Array.from(itemMap.values());
};

const getFullName = (user = {}) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
  user.full_name ||
  user.fullName ||
  user.email ||
  'Unnamed user';

const getBarangay = (user = {}) =>
  (user.barangay || user.address || 'Not set').toString().trim() || 'Not set';

const hexToRgb = (hex) => {
  const normalizedHex = hex.replace('#', '');
  const value = parseInt(normalizedHex, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

const getBlueShade = (index, total) => {
  const start = hexToRgb('#1D4ED8');
  const end = hexToRgb('#BFDBFE');
  const ratio = total <= 1 ? 0 : Math.min(index / Math.max(total - 1, 1), 1);

  return rgbToHex({
    r: start.r + (end.r - start.r) * ratio,
    g: start.g + (end.g - start.g) * ratio,
    b: start.b + (end.b - start.b) * ratio,
  });
};

const prepareBarangayDonutRows = (rows = []) => {
  const sortedRows = [...rows]
    .filter((row) => Number(row.value || 0) > 0)
    .sort((left, right) => right.value - left.value);
  const groupedRows =
    sortedRows.length > BARANGAY_DONUT_LIMIT
      ? [
          ...sortedRows.slice(0, BARANGAY_DONUT_LIMIT - 1),
          {
            label: 'Others',
            value: sortedRows
              .slice(BARANGAY_DONUT_LIMIT - 1)
              .reduce((sum, row) => sum + Number(row.value || 0), 0),
          },
        ]
      : sortedRows;
  const displayRows =
    groupedRows.length > 0 ? groupedRows : [{ label: 'No data', value: 0 }];

  return displayRows.map((row, index) => ({
    ...row,
    color: getBlueShade(index, displayRows.length),
  }));
};

const getJoinedLabel = (user = {}) => {
  const value = user.createdAt || user.created_at || user.joinedAt || user.joined;

  if (!value) return 'Not set';

  let date = null;

  if (typeof value?.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value?.toMillis === 'function') {
    date = new Date(value.toMillis());
  } else if (value.seconds) {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const buildBarangayRows = (users = []) => {
  const counts = new Map();

  users.forEach((user) => {
    const barangay = getBarangay(user);
    if (barangay === 'Not set') return;
    counts.set(barangay, (counts.get(barangay) || 0) + 1);
  });

  const rows = Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);

  return rows.length > 0
    ? rows
    : [
        { label: 'Downtown', value: 0 },
        { label: 'San Jose', value: 0 },
        { label: 'Others', value: 0 },
      ];
};

const buildTrend = (totalSales) => {
  const safeSales = Math.max(Number(totalSales || 0), 0);
  const factors = [0.52, 0.6, 0.56, 0.68, 0.76, 1];

  return ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'].map((month, index) => ({
    month,
    value: safeSales > 0 ? Math.round(safeSales * factors[index]) : 0,
  }));
};

const getNiceMax = (value) => {
  const safeValue = Math.max(Number(value || 0), 1);
  const magnitude = 10 ** Math.max(String(Math.floor(safeValue)).length - 1, 0);

  return Math.ceil(safeValue / magnitude) * magnitude;
};

const getLineSegments = (points) =>
  points.slice(0, -1).map((point, index) => {
    const nextPoint = points[index + 1];
    const deltaX = nextPoint.x - point.x;
    const deltaY = nextPoint.y - point.y;
    const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    return {
      key: `${point.label}-${nextPoint.label}`,
      left: point.x + deltaX / 2 - length / 2,
      top: point.y + deltaY / 2 - LINE_THICKNESS / 2,
      width: length,
      angle,
    };
  });

const PanelSurface = ({ children, progress, style }) => {
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View
      style={[
        styles.panel,
        style,
        {
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

const MetricValue = ({
  delay = 0,
  enabled,
  reducedMotion,
  value,
}) => {
  const valueParts =
    typeof value === 'string'
      ? value.match(/^(\d+)\s*\/\s*(\d+)$/)
      : null;
  const numericValue =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/,/g, ''));
  const hasNumericValue = Number.isFinite(numericValue);
  const countValue = useAnimatedNumber(
    hasNumericValue ? numericValue : 0,
    enabled && hasNumericValue && !valueParts,
    reducedMotion,
    { delay }
  );
  const slashLeft = useAnimatedNumber(
    valueParts ? Number(valueParts[1]) : 0,
    enabled && !!valueParts,
    reducedMotion,
    { delay }
  );
  const slashRight = useAnimatedNumber(
    valueParts ? Number(valueParts[2]) : 0,
    enabled && !!valueParts,
    reducedMotion,
    { delay }
  );

  if (valueParts) {
    return `${slashLeft} / ${slashRight}`;
  }

  if (hasNumericValue) {
    return formatManagerNumber(countValue);
  }

  return value;
};

const MetricCard = ({
  accent = BLUE,
  delay = 0,
  enabled,
  helper,
  label,
  progress,
  reducedMotion,
  value,
}) => {
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <Animated.View
      style={[
        styles.metricCard,
        {
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <ManagerWaterDrop color={accent} size={22} />
      </View>
      <Text style={styles.metricValue}>
        <MetricValue
          delay={delay}
          enabled={enabled}
          reducedMotion={reducedMotion}
          value={value}
        />
      </Text>
      <Text style={[styles.metricHelper, { color: accent }]}>{helper}</Text>
    </Animated.View>
  );
};

const TrendPanel = ({
  areaProgress,
  data,
  lineProgress,
  panelProgress,
  pointProgresses,
  reducedMotion,
}) => {
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });
  const [activeTooltip, setActiveTooltip] = useState(null);
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const maxValue = getNiceMax(Math.max(...data.map((item) => item.value), 0));
  const ticks = [
    maxValue,
    Math.round(maxValue * 0.75),
    Math.round(maxValue * 0.5),
    Math.round(maxValue * 0.25),
    0,
  ];
  const points = data.map((item, index) => ({
    label: item.month,
    value: item.value,
    xPercent: data.length <= 1 ? 0 : (index / (data.length - 1)) * 100,
    yPercent: 100 - (item.value / maxValue) * 100,
  }));
  const measuredPoints =
    plotSize.width > 0 && plotSize.height > 0
      ? points.map((point) => ({
          ...point,
          x: (point.xPercent / 100) * plotSize.width,
          y: (point.yPercent / 100) * plotSize.height,
        }))
      : [];
  const segments = getLineSegments(measuredPoints);
  const revealWidth =
    plotSize.width > 0
      ? lineProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, plotSize.width + 8],
        })
      : 0;
  const areaClipStyle =
    Platform.OS === 'web' && points.length > 1
      ? {
          clipPath: `polygon(0% 100%, ${points
            .map((point) => `${point.xPercent}% ${point.yPercent}%`)
            .join(', ')}, 100% 100%)`,
        }
      : null;
  const tooltipPoint = measuredPoints.find(
    (point) => point.label === activeTooltip
  );
  const handlePlotLayout = ({ nativeEvent }) => {
    const { width, height } = nativeEvent.layout;

    setPlotSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height }
    );
  };

  useEffect(() => {
    Animated.timing(tooltipOpacity, {
      toValue: activeTooltip ? 1 : 0,
      duration: reducedMotion ? 0 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [activeTooltip, reducedMotion, tooltipOpacity]);

  return (
    <PanelSurface progress={panelProgress} style={styles.trendPanel}>
      <Text style={styles.panelTitle}>Product sales trend (gallons ordered)</Text>
      <View style={styles.lineChartWrap}>
        <View style={styles.yAxis}>
          {ticks.map((tick, index) => (
            <Text key={`${tick}-${index}`} style={styles.axisText}>
              {tick}
            </Text>
          ))}
        </View>

        <View style={styles.lineChart}>
          <View style={styles.chartPlotLayer} onLayout={handlePlotLayout}>
            {ticks.map((tick, index) => (
              <View
                key={`grid-${tick}-${index}`}
                style={[
                  styles.gridLine,
                  { top: `${(index / (ticks.length - 1)) * 100}%` },
                ]}
              />
            ))}

            {plotSize.width > 0 && (
              <Animated.View
                pointerEvents="box-none"
                style={[styles.lineRevealLayer, { width: revealWidth }]}
              >
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.lineDataLayer,
                    { width: plotSize.width, height: plotSize.height },
                  ]}
                >
                  {Platform.OS === 'web' && (
                    <Animated.View
                      style={[
                        styles.areaFill,
                        areaClipStyle,
                        { opacity: areaProgress },
                      ]}
                    />
                  )}

                  {segments.map((segment) => (
                    <View
                      key={segment.key}
                      style={[
                        styles.lineSegment,
                        {
                          left: segment.left,
                          top: segment.top,
                          width: segment.width,
                          transform: [{ rotate: `${segment.angle}deg` }],
                        },
                      ]}
                    />
                  ))}

                  {measuredPoints.map((point, index) => {
                    const pointProgress =
                      pointProgresses[index] || pointProgresses[0] || lineProgress;
                    const handlers =
                      Platform.OS === 'web'
                        ? {
                            onMouseEnter: () => setActiveTooltip(point.label),
                            onMouseLeave: () => setActiveTooltip(null),
                          }
                        : {};

                    return (
                      <Animated.View
                        key={point.label}
                        {...handlers}
                        style={[
                          styles.lineDot,
                          {
                            left: point.x,
                            top: point.y,
                            opacity: pointProgress,
                            transform: [{ scale: pointProgress }],
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              </Animated.View>
            )}

            {tooltipPoint && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.chartTooltip,
                  {
                    left: Math.max(
                      0,
                      Math.min(tooltipPoint.x - 28, plotSize.width - 58)
                    ),
                    top: Math.max(0, tooltipPoint.y - 42),
                    opacity: tooltipOpacity,
                  },
                ]}
              >
                <Text style={styles.chartTooltipText}>
                  {formatManagerNumber(tooltipPoint.value)}
                </Text>
              </Animated.View>
            )}
          </View>

          <View style={styles.xAxisLabels}>
            {data.map((item) => (
              <Text key={item.month} style={styles.axisText}>
                {item.month}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </PanelSurface>
  );
};

const CompositionPanel = ({
  distributors,
  legendProgresses,
  panelProgress,
  requesters,
}) => {
  const rows = [
    { label: 'Distributors', value: distributors, color: BLUE_DARK },
    { label: 'Requesters', value: requesters, color: BLUE_MID },
  ];
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const tickValues = [
    0,
    Math.ceil(maxValue * 0.25),
    Math.ceil(maxValue * 0.5),
    Math.ceil(maxValue * 0.75),
    maxValue,
  ];

  return (
    <PanelSurface progress={panelProgress} style={styles.compositionPanel}>
      <Text style={styles.panelTitle}>User composition</Text>
      <View style={styles.barangayChart}>
        <View style={styles.barGridLayer}>
          {[0, 25, 50, 75, 100].map((left) => (
            <View
              key={left}
              style={[styles.verticalGridLine, { left: `${left}%` }]}
            />
          ))}
        </View>

        {rows.map((row, index) => {
          const targetWidth =
            row.value <= 0 ? 0 : Math.max(7, (row.value / maxValue) * 100);
          const animatedWidth = legendProgresses[index].interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', `${targetWidth}%`],
          });

          return (
            <View key={row.label} style={styles.barangayRow}>
              <Text style={styles.barangayLabel} numberOfLines={1}>
                {row.label}
              </Text>
              <View style={styles.barTrack}>
                <Animated.View
                  style={[
                    styles.barFill,
                    { width: animatedWidth, backgroundColor: row.color },
                  ]}
                />
              </View>
            </View>
          );
        })}

        <View style={styles.barAxis}>
          <View style={styles.barAxisSpacer} />
          <View style={styles.barAxisValues}>
            {tickValues.map((tick, index) => (
              <Text key={`${tick}-${index}`} style={styles.axisText}>
                {tick}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </PanelSurface>
  );
};

const BarangayPanel = ({ progress, rows }) => {
  const safeRows = prepareBarangayDonutRows(rows);
  const total = Math.max(
    safeRows.reduce((sum, row) => sum + Number(row.value || 0), 0),
    1
  );
  const donutSweep = useAnimatedValueSnapshot(progress, 0);
  let runningDegrees = 0;
  const webDonutStyle =
    Platform.OS === 'web'
      ? {
          backgroundImage: `conic-gradient(${safeRows
            .map((row, index) => {
              const segmentDegrees =
                (Number(row.value || 0) / total) * 360 * donutSweep;
              const start = runningDegrees;
              const end = runningDegrees + segmentDegrees;
              runningDegrees = end;

              return `${row.color} ${start}deg ${end}deg`;
            })
            .join(', ')}, ${BLUE_LIGHT} ${runningDegrees}deg 360deg)`,
        }
      : null;
  const ringScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1],
  });
  const ringRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-8deg', '0deg'],
  });

  return (
    <PanelSurface progress={progress} style={styles.barangayPanel}>
      <Text style={styles.panelTitle}>Registered users by barangay</Text>
      <View style={styles.compositionBody}>
        <Animated.View
          style={[
            styles.donutShell,
            webDonutStyle,
            {
              opacity: progress,
              transform: [{ rotate: ringRotate }, { scale: ringScale }],
            },
          ]}
        >
          {Platform.OS !== 'web' && (
            <>
              <View
                style={[
                  styles.nativeDonutSegmentDark,
                  {
                    backgroundColor: safeRows[0]?.color || '#1D4ED8',
                    height: `${Math.max(8, 56 * donutSweep)}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.nativeDonutSegmentLight,
                  {
                    backgroundColor:
                      safeRows[1]?.color || safeRows[0]?.color || '#93C5FD',
                    height: `${Math.max(8, 44 * donutSweep)}%`,
                  },
                ]}
              />
            </>
          )}
          <View style={styles.donutHole}>
            <Animated.Text style={[styles.donutPercent, { opacity: progress }]}>
              {formatManagerNumber(total)}
            </Animated.Text>
          </View>
        </Animated.View>

        <View style={styles.legendRow}>
          {safeRows.map((row) => (
            <Animated.View
              key={row.label}
              style={[
                styles.legendItem,
                {
                  opacity: progress,
                  transform: [
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: row.color },
                ]}
              />
              <Text style={styles.legendText}>
                {row.label} {row.value}
              </Text>
            </Animated.View>
          ))}
        </View>
      </View>
    </PanelSurface>
  );
};

const StationsPanel = ({ progress, stations }) => {
  const stationRows = stations.map((station, index) => ({
    id: station,
    name: `Station ${String.fromCharCode(65 + index)} - ${station}`,
    gallons:
      index === 0 ? '5,200 gal sold' : index === 1 ? '3,230 gal sold' : '0 gal sold',
    active: index < stations.length,
  }));

  return (
    <PanelSurface progress={progress} style={styles.stationsPanel}>
      <Text style={styles.panelTitle}>Stations</Text>
      <View style={styles.stationList}>
        {stationRows.map((station, index) => {
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [16, 0],
          });

          return (
            <Animated.View
              key={station.id}
              style={[
                styles.stationRow,
                {
                  opacity: progress,
                  transform: [{ translateX }],
                },
              ]}
            >
              <ManagerWaterDrop
                color={index % 2 === 0 ? BLUE : BLUE_MID}
                outline={!station.active}
                size={28}
              />
              <View style={styles.stationTextBlock}>
                <Text style={styles.stationName}>{station.name}</Text>
                <Text style={styles.stationSales}>{station.gallons}</Text>
              </View>
              <ManagerPill tone={station.active ? 'green' : 'red'}>
                {station.active ? 'Active' : 'Offline'}
              </ManagerPill>
            </Animated.View>
          );
        })}
      </View>
    </PanelSurface>
  );
};

export default function ManagerDashboard() {
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [accountsTab, setAccountsTab] = useState('distributors');
  const [dashboardStats, setDashboardStats] = useState({
    registeredUsers: 0,
    registeredDistributors: 0,
    registeredRequesters: 0,
    productSales: 0,
    stations: defaultStations.length,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [removingId, setRemovingId] = useState(null);
  const [statsReady, setStatsReady] = useState(false);
  const reducedMotion = useReducedMotionPreference();
  const cardProgresses = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0))
  ).current;
  const panelProgress = useRef(new Animated.Value(0)).current;
  const lineProgress = useRef(new Animated.Value(0)).current;
  const areaProgress = useRef(new Animated.Value(0)).current;
  const pointProgresses = useRef(
    Array.from({ length: 6 }, () => new Animated.Value(0))
  ).current;
  const legendProgresses = useRef(
    Array.from({ length: 2 }, () => new Animated.Value(0))
  ).current;
  const barProgress = useRef(new Animated.Value(0)).current;
  const stationProgress = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    let firestoreRegistered = [];
    let hasResolvedFirestore = false;

    const refreshRegisteredDistributors = (
      nextFirestoreRegistered = firestoreRegistered,
      options = {}
    ) => {
      firestoreRegistered = nextFirestoreRegistered;

      if (!hasResolvedFirestore && !options.allowBeforeFirestore) {
        return;
      }

      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered),
      ]);
      setLoading(false);
    };

    const unsubscribeLocalUsers = subscribeLocalUsers(() =>
      refreshRegisteredDistributors()
    );

    const registeredQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor')
    );

    const unsubscribe = onSnapshot(
      registeredQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => getDistributorApplicationStatus(item) === 'approved');

        hasResolvedFirestore = true;
        refreshRegisteredDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Registered distributors error:', error.message);
        setLoadError(error.message);
        hasResolvedFirestore = true;
        refreshRegisteredDistributors(firestoreRegistered, {
          allowBeforeFirestore: true,
        });
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, []);

  useEffect(() => {
    let firestoreUsers = [];
    let firestoreRequests = [];
    let usersReady = false;
    let requestsReady = false;

    const refreshDashboardStats = () => {
      if (!usersReady || !requestsReady) {
        return;
      }

      const mergedUsers = mergeByIdentity([
        ...firestoreUsers,
        ...getLocalUsers(),
      ]);
      const localRequests = getLocalRequests();
      const requestIds = new Set(firestoreRequests.map((item) => item.id));
      const allRequests = [
        ...firestoreRequests,
        ...localRequests.filter((item) => !requestIds.has(item.id)),
      ];
      const stationNames = new Set(defaultStations);
      const registeredRequesters = mergedUsers.filter(
        (user) => normalizeRole(user.role) === 'requester'
      ).length;
      const registeredDistributorCount = mergedUsers.filter(
        (user) => normalizeRole(user.role) === 'distributor'
      ).length;

      allRequests.forEach((request) => {
        if (request.water_station) {
          stationNames.add(String(request.water_station).trim().toLowerCase());
        }
      });

      setAllUsers(mergedUsers);
      setDashboardStats({
        registeredUsers: mergedUsers.length,
        registeredDistributors: registeredDistributorCount,
        registeredRequesters,
        productSales: allRequests.reduce(
          (sum, request) => sum + getRequestQuantity(request),
          0
        ),
        stations: stationNames.size,
      });
      setStatsReady(true);
    };

    const unsubscribeLocalUsers = subscribeLocalUsers(refreshDashboardStats);

    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        firestoreUsers = snapshot.docs.map((item) => ({
          id: item.id,
          uid: item.id,
          ...item.data(),
        }));
        usersReady = true;
        refreshDashboardStats();
      },
      (error) => {
        console.log('Dashboard users metric error:', error.message);
        usersReady = true;
        refreshDashboardStats();
      }
    );

    const unsubscribeRequests = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        firestoreRequests = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        requestsReady = true;
        refreshDashboardStats();
      },
      (error) => {
        console.log('Dashboard requests metric error:', error.message);
        requestsReady = true;
        refreshDashboardStats();
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeRequests();
      unsubscribeLocalUsers();
    };
  }, []);

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return registeredDistributors;

    return registeredDistributors.filter((distributor) =>
      [
        getFullName(distributor),
        getProfileUniqueId(distributor),
        distributor.email,
        distributor.phone,
        getBarangay(distributor),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [registeredDistributors, search]);
  const registeredRequesters = useMemo(
    () =>
      allUsers.filter((user) => normalizeRole(user.role) === 'requester'),
    [allUsers]
  );
  const filteredRequesters = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return registeredRequesters;

    return registeredRequesters.filter((requester) =>
      [
        getFullName(requester),
        getProfileUniqueId(requester),
        requester.email,
        requester.phone,
        getBarangay(requester),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [registeredRequesters, search]);
  const activeAccounts =
    accountsTab === 'requesters' ? filteredRequesters : filteredDistributors;
  const activeAccountsLabel =
    accountsTab === 'requesters' ? 'requesters' : 'distributors';

  const barangayRows = useMemo(() => buildBarangayRows(allUsers), [allUsers]);
  const trendData = useMemo(
    () => buildTrend(dashboardStats.productSales),
    [dashboardStats.productSales]
  );

  useEffect(() => {
    if (!statsReady || hasAnimated.current) return;

    hasAnimated.current = true;
    const values = [
      ...cardProgresses,
      panelProgress,
      lineProgress,
      areaProgress,
      ...pointProgresses,
      ...legendProgresses,
      barProgress,
      stationProgress,
    ];

    if (reducedMotion) {
      values.forEach((value) => value.setValue(1));
      return;
    }

    const timing = (value, duration = 850, delay = 0) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });

    Animated.parallel([
      Animated.stagger(120, cardProgresses.map((value) => timing(value, 620))),
      timing(panelProgress, 650, 120),
      Animated.sequence([
        timing(lineProgress, 950, 180),
        timing(areaProgress, 260),
      ]),
      Animated.stagger(
        80,
        pointProgresses.map((value, index) => timing(value, 260, 220 + index * 40))
      ),
      Animated.stagger(
        100,
        legendProgresses.map((value) => timing(value, 300, 820))
      ),
      timing(barProgress, 900, 340),
      timing(stationProgress, 620, 420),
    ]).start();
  }, [
    areaProgress,
    barProgress,
    cardProgresses,
    legendProgresses,
    lineProgress,
    panelProgress,
    pointProgresses,
    reducedMotion,
    stationProgress,
    statsReady,
  ]);

  const removeDistributor = async (distributor) => {
    const id = distributor.uid || distributor.id;

    try {
      setRemovingId(id);
      updateLocalUserStatus(id, 'rejected');
      setRegisteredDistributors((current) =>
        current.filter((item) => item.uid !== id && item.id !== id)
      );

      try {
        const uniqueId = getProfileUniqueId(distributor);
        const removePayload = {
          uid: id,
          firstName: distributor.firstName || '',
          lastName: distributor.lastName || '',
          email: distributor.email || '',
          phone: distributor.phone || '',
          barangay: distributor.barangay || distributor.address || '',
          address: distributor.address || distributor.barangay || '',
          role: 'distributor',
          approvalStatus: 'rejected',
          status: 'Rejected',
          rejectionReason: distributor.rejectionReason || null,
          removedAt: serverTimestamp(),
        };

        if (uniqueId) {
          removePayload.unique_id = uniqueId;
        }

        await setDoc(doc(db, 'users', id), removePayload, { merge: true });
      } catch (error) {
        console.log('Distributor Firestore remove error:', error.message);
        Alert.alert(
          'Saved locally',
          'The distributor was removed on this device, but Firestore did not accept the change.'
        );
      }
    } catch (error) {
      console.log('Distributor remove error:', error.message);
      Alert.alert('Remove failed', error.message);
    } finally {
      setRemovingId(null);
    }
  };

  const confirmRemoveDistributor = (distributor, fullName) => {
    if (globalThis.confirm) {
      if (globalThis.confirm(`Remove ${fullName}?`)) {
        removeDistributor(distributor);
      }
      return;
    }

    Alert.alert('Remove distributor', `Remove ${fullName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeDistributor(distributor),
      },
    ]);
  };

  return (
    <ManagerShell
      active="dashboard"
      title="Data overview"
      subtitle="BlueTap network - updated just now"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <View style={styles.metricGrid}>
        <MetricCard
          label="OVERALL REGISTERED USERS"
          value={dashboardStats.registeredUsers}
          helper="+18 this month"
          accent={BLUE}
          delay={0}
          enabled={statsReady}
          progress={cardProgresses[0]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="REGISTERED DISTRIBUTORS"
          value={dashboardStats.registeredDistributors}
          helper="Approved and pending"
          accent={BLUE_DARK}
          delay={120}
          enabled={statsReady}
          progress={cardProgresses[1]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="REGISTERED REQUESTERS"
          value={dashboardStats.registeredRequesters}
          helper="Active user base"
          accent={BLUE_MID}
          delay={240}
          enabled={statsReady}
          progress={cardProgresses[2]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="PRODUCT SALES (GALLONS)"
          value={dashboardStats.productSales}
          helper="+22% vs last month"
          accent={BLUE}
          delay={360}
          enabled={statsReady}
          progress={cardProgresses[3]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="STATIONS ONLINE"
          value={`${dashboardStats.stations} / ${dashboardStats.stations}`}
          helper="All stations active"
          accent={BLUE_MID}
          delay={480}
          enabled={statsReady}
          progress={cardProgresses[4]}
          reducedMotion={reducedMotion}
        />
      </View>

      <View style={styles.panelGrid}>
        <TrendPanel
          areaProgress={areaProgress}
          data={trendData}
          lineProgress={lineProgress}
          panelProgress={panelProgress}
          pointProgresses={pointProgresses}
          reducedMotion={reducedMotion}
        />
        <BarangayPanel progress={barProgress} rows={barangayRows} />
      </View>

      <View style={styles.panelGrid}>
        <CompositionPanel
          distributors={dashboardStats.registeredDistributors}
          legendProgresses={legendProgresses}
          panelProgress={panelProgress}
          requesters={dashboardStats.registeredRequesters}
        />
        <StationsPanel
          progress={stationProgress}
          stations={Array.from(new Set(defaultStations))}
        />
      </View>

      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableTitle}>Registered accounts</Text>
          <View style={styles.tableTabs}>
            <TouchableOpacity
              activeOpacity={0.82}
              style={
                accountsTab === 'distributors'
                  ? styles.tableTabActive
                  : styles.tableTab
              }
              onPress={() => setAccountsTab('distributors')}
            >
              <Text
                style={
                  accountsTab === 'distributors'
                    ? styles.tableTabActiveText
                    : styles.tableTabText
                }
              >
                Distributors {registeredDistributors.length}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.82}
              style={
                accountsTab === 'requesters'
                  ? styles.tableTabActive
                  : styles.tableTab
              }
              onPress={() => setAccountsTab('requesters')}
            >
              <Text
                style={
                  accountsTab === 'requesters'
                    ? styles.tableTabActiveText
                    : styles.tableTabText
                }
              >
                Requesters {dashboardStats.registeredRequesters}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.tableRow, styles.tableHeadRow]}>
          <Text style={[styles.th, styles.nameCol]}>NAME</Text>
          <Text style={[styles.th, styles.idCol]}>UNIQUE ID</Text>
          <Text style={[styles.th, styles.contactCol]}>CONTACT</Text>
          <Text style={[styles.th, styles.emailCol]}>EMAIL</Text>
          <Text style={[styles.th, styles.barangayCol]}>BARANGAY</Text>
          <Text style={[styles.th, styles.joinedCol]}>JOINED</Text>
          <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={MANAGER_COLORS.blue} size="small" />
          </View>
        ) : activeAccounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No registered {activeAccountsLabel} yet.
            </Text>
            {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
          </View>
        ) : (
          activeAccounts.map((account) => {
            const fullName = getFullName(account);
            const accountId = account.uid || account.id;
            const isDistributorRow = accountsTab === 'distributors';
            const isRemoving = removingId === accountId;

            return (
              <View key={accountId || account.email} style={styles.tableRow}>
                <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>
                  {fullName}
                </Text>
                <Text style={[styles.td, styles.idCol]} numberOfLines={1}>
                  {getProfileUniqueId(account) || 'Not set'}
                </Text>
                <Text style={[styles.td, styles.contactCol]} numberOfLines={1}>
                  {account.phone || 'Not set'}
                </Text>
                <Text style={[styles.tdLink, styles.emailCol]} numberOfLines={1}>
                  {account.email || 'Not set'}
                </Text>
                <Text style={[styles.td, styles.barangayCol]} numberOfLines={1}>
                  {getBarangay(account)}
                </Text>
                <Text style={[styles.td, styles.joinedCol]} numberOfLines={1}>
                  {getJoinedLabel(account)}
                </Text>
                <View style={[styles.actionsCell, styles.actionsCol]}>
                  {isDistributorRow ? (
                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={[styles.removeButton, isRemoving && styles.actionDisabled]}
                      onPress={() => confirmRemoveDistributor(account, fullName)}
                      disabled={isRemoving}
                    >
                      <Text style={styles.removeButtonText}>
                        {isRemoving ? 'Removing...' : 'Remove'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.noActionText}>View only</Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </ManagerShell>
  );
}

const styles = StyleSheet.create({
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 20,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 124,
    backgroundColor: MANAGER_COLORS.card,
    borderWidth: 1,
    borderColor: MANAGER_COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 18,
    justifyContent: 'space-between',
  },
  metricHeader: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metricLabel: {
    flex: 1,
    color: MANAGER_COLORS.muted,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  metricValue: {
    color: MANAGER_COLORS.text,
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  metricHelper: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  panelGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  panel: {
    backgroundColor: MANAGER_COLORS.card,
    borderWidth: 1,
    borderColor: MANAGER_COLORS.border,
    borderRadius: 8,
    padding: 20,
  },
  trendPanel: {
    flex: 1.3,
    minHeight: 310,
  },
  compositionPanel: {
    flex: 1.3,
    minHeight: 310,
  },
  barangayPanel: {
    flex: 1,
    minHeight: 320,
  },
  stationsPanel: {
    flex: 1,
    minHeight: 320,
  },
  panelTitle: {
    color: MANAGER_COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 18,
  },
  lineChartWrap: {
    flex: 1,
    minHeight: 232,
    flexDirection: 'row',
  },
  yAxis: {
    width: 46,
    justifyContent: 'space-between',
    paddingBottom: 28,
  },
  axisText: {
    color: MANAGER_COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  lineChart: {
    flex: 1,
    minHeight: 232,
    borderBottomWidth: 1,
    borderBottomColor: MANAGER_COLORS.border,
    position: 'relative',
    marginLeft: 2,
    marginRight: 10,
    paddingBottom: 28,
  },
  chartPlotLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 28,
    left: 0,
  },
  lineRevealLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  lineDataLayer: {
    position: 'relative',
  },
  areaFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(24,123,205,0.12)',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: MANAGER_COLORS.border,
  },
  lineSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 999,
    backgroundColor: BLUE,
  },
  lineDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    marginTop: -5,
    backgroundColor: BLUE_DARK,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 2,
  },
  chartTooltip: {
    position: 'absolute',
    minWidth: 56,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: MANAGER_COLORS.text,
    paddingHorizontal: 8,
    paddingVertical: 5,
    zIndex: 4,
  },
  chartTooltipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  xAxisLabels: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compositionBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutShell: {
    width: 160,
    height: 160,
    borderRadius: 80,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUE_MID,
    position: 'relative',
  },
  nativeDonutSegmentDark: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '52%',
    backgroundColor: BLUE_DARK,
  },
  nativeDonutSegmentLight: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    backgroundColor: BLUE_MID,
  },
  donutHole: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  donutPercent: {
    color: MANAGER_COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginTop: 24,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
    marginRight: 6,
  },
  legendDotDark: {
    backgroundColor: BLUE_DARK,
  },
  legendDotLight: {
    backgroundColor: BLUE_MID,
  },
  legendText: {
    color: MANAGER_COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  barangayChart: {
    flex: 1,
    minHeight: 234,
    position: 'relative',
    justifyContent: 'center',
    gap: 12,
  },
  barGridLayer: {
    position: 'absolute',
    top: 6,
    right: 18,
    bottom: 28,
    left: 90,
  },
  verticalGridLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: MANAGER_COLORS.border,
  },
  barangayRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barangayLabel: {
    width: 80,
    color: MANAGER_COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    marginRight: 10,
  },
  barTrack: {
    flex: 1,
    height: 15,
    borderRadius: 5,
    backgroundColor: BLUE_LIGHT,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: BLUE_MID,
  },
  barAxis: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  barAxisSpacer: {
    width: 90,
  },
  barAxisValues: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: 18,
  },
  stationList: {
    gap: 20,
    paddingTop: 4,
  },
  stationRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stationTextBlock: {
    flex: 1,
    marginLeft: 18,
    marginRight: 16,
  },
  stationName: {
    color: MANAGER_COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  stationSales: {
    color: MANAGER_COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  tableCard: {
    backgroundColor: MANAGER_COLORS.card,
    borderWidth: 1,
    borderColor: MANAGER_COLORS.border,
    borderRadius: 8,
    padding: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  tableTitle: {
    color: MANAGER_COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  tableTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  tableTabActive: {
    borderRadius: 20,
    backgroundColor: MANAGER_COLORS.blue,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tableTabActiveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableTab: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: MANAGER_COLORS.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tableTabText: {
    color: MANAGER_COLORS.muted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: MANAGER_COLORS.border,
  },
  tableHeadRow: {
    minHeight: 38,
  },
  th: {
    color: MANAGER_COLORS.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  td: {
    color: MANAGER_COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  tdName: {
    color: MANAGER_COLORS.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  tdLink: {
    color: MANAGER_COLORS.blue,
    fontSize: 13,
    fontWeight: '600',
  },
  nameCol: {
    flex: 1.35,
  },
  idCol: {
    flex: 1.05,
  },
  contactCol: {
    flex: 1.05,
  },
  emailCol: {
    flex: 1.65,
  },
  barangayCol: {
    flex: 1,
  },
  joinedCol: {
    flex: 0.85,
  },
  actionsCol: {
    flex: 0.8,
    textAlign: 'right',
  },
  actionsCell: {
    alignItems: 'flex-end',
  },
  removeButton: {
    borderRadius: 999,
    backgroundColor: '#FFE9E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButtonText: {
    color: MANAGER_COLORS.red,
    fontSize: 12,
    fontWeight: 'bold',
  },
  noActionText: {
    color: MANAGER_COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: MANAGER_COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: MANAGER_COLORS.red,
    fontSize: 12,
    marginTop: 8,
  },
});
