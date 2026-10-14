import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { getLocalUsers, subscribeLocalUsers } from '../../localUsers';
import { getLocalRequests, subscribeLocalRequests } from '../../services/requests';
import { getManagerOrderAnalytics, mergeManagerBranchRequests } from '../../services/managerAnalytics';
import { getProfileUniqueId } from '../../services/uniqueIds';
import { useAdminTheme } from '../../components/AdminTheme';
import AdminIcon from '../../components/AdminIcon';
import { accountPageMeta, accountPageNumbers, accountPageSlice } from '../../services/adminAccountsPagination';
import ManagerShell, {
  MANAGER_COLORS,
  ManagerPill,
  ManagerWaterDrop,
} from '../../components/ManagerShell';
import { extractBranchRequesters, useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import {
  formatManagerNumber,
  useAnimatedNumber,
  useAnimatedValueSnapshot,
  useReducedMotionPreference,
} from '../../components/managerAnimationHooks';

let styles;

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

const getDistributorApplicationStatus = (distributor) =>
  normalizeApplicationStatus(
    distributor.distributorStatus ||
      distributor.status ||
      distributor.approvalStatus ||
      distributor.accountStatus ||
      'pending'
  );

const getRegisteredLocalDistributors = (firestoreDistributors = [], branchId = '') =>
  getLocalUsers()
    .filter(
      (user) =>
        user.branchId === branchId &&
        normalizeRole(user.role) === 'distributor' &&
        ['approved', 'active'].includes(getDistributorApplicationStatus(user))
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

const BLUE_DARK = '#0D47A1';
const BLUE = '#187BCD';
const BLUE_MID = '#42A5F5';
const BLUE_LIGHT = '#E3F2FD';
const LINE_THICKNESS = 3;
const BARANGAY_DONUT_LIMIT = 8;

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
      <Text style={styles.panelTitle}>Delivered units by month</Text>
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

const StationsPanel = ({ progress, station }) => {
  const stationName = station?.name || 'Assigned Branch';
  const unitsSold = station?.unitsSold || 0;
  const snapshotRevenue = station?.snapshotRevenue || 0;
  const isActive = station?.status !== 'inactive' && station?.status !== 'disabled';
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <PanelSurface progress={progress} style={styles.stationsPanel}>
      <Text style={styles.panelTitle}>Branch Station</Text>
      <View style={styles.stationList}>
        <Animated.View
          style={[
            styles.stationRow,
            {
              opacity: progress,
              transform: [{ translateX }],
            },
          ]}
        >
          <ManagerWaterDrop
            color={BLUE}
            outline={!isActive}
            size={28}
          />
          <View style={styles.stationTextBlock}>
            <Text style={styles.stationName}>{stationName}</Text>
            <Text style={styles.stationSales}>
              {formatManagerNumber(unitsSold)} Units Sold · ₱{Number(snapshotRevenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Revenue
            </Text>
          </View>
          <ManagerPill tone={isActive ? 'green' : 'red'}>
            {isActive ? 'Active' : 'Offline'}
          </ManagerPill>
        </Animated.View>
      </View>
    </PanelSurface>
  );
};

export default function ManagerDashboard() {
  const { colors, resolvedTheme } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const { width } = useWindowDimensions();
  styles = createStyles(colors, width, isDark);
  const { branchId, users: realtimeUsers, requests: realtimeRequests, branch: realtimeBranch, requesters: realtimeRequesters = [], loading: realtimeLoading, error: realtimeError } = useManagerRealtimeData();
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allRequesters, setAllRequesters] = useState([]);
  const [search, setSearch] = useState('');
  const [accountsTab, setAccountsTab] = useState('distributors');
  const [currentPage, setCurrentPage] = useState(1);
  const [branchData, setBranchData] = useState(null);
  const [dashboardStats, setDashboardStats] = useState({
    registeredUsers: 0,
    registeredDistributors: 0,
    registeredRequesters: 0,
    productSales: 0,
    salesTrend: [],
    stations: 1,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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
    const refreshRegisteredDistributors = () => {
      const firestoreRegistered = realtimeUsers.filter(
        (item) => normalizeRole(item.role) === 'distributor' &&
          ['approved', 'active'].includes(getDistributorApplicationStatus(item))
      );
      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered, branchId),
      ]);
      setLoading(realtimeLoading);
      setLoadError(realtimeError);
    };

    refreshRegisteredDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(refreshRegisteredDistributors);

    return unsubscribeLocalUsers;
  }, [branchId, realtimeError, realtimeLoading, realtimeUsers]);

  useEffect(() => {
    const refreshDashboardStats = () => {
      const mergedUsers = mergeByIdentity([
        ...realtimeUsers,
        ...getLocalUsers().filter((user) => user.branchId === branchId),
      ]);
      const allRequests = mergeManagerBranchRequests(realtimeRequests, getLocalRequests(), branchId);
      const branchRequesters = extractBranchRequesters(allRequests, [
        ...mergedUsers,
        ...getLocalUsers(),
        ...realtimeRequesters,
      ]);
      const registeredDistributorCount = mergedUsers.filter(
        (user) => normalizeRole(user.role) === 'distributor'
      ).length;
      const registeredRequesterCount = branchRequesters.length;
      const registeredUsers = registeredDistributorCount + registeredRequesterCount;

      const orderAnalytics = getManagerOrderAnalytics(allRequests);
      const { units: unitsSold, revenue: snapshotRevenue } = orderAnalytics;

      setAllUsers(mergedUsers);
      setAllRequesters(branchRequesters);
      setDashboardStats({
        registeredUsers,
        registeredDistributors: registeredDistributorCount,
        registeredRequesters: registeredRequesterCount,
        productSales: unitsSold,
        salesTrend: orderAnalytics.trend,
        stations: 1,
      });
      setBranchData({
        name: realtimeBranch?.name || realtimeBranch?.branchName || (branchId ? `Branch ${branchId}` : 'Assigned Branch'),
        status: realtimeBranch?.status || 'active',
        unitsSold,
        snapshotRevenue,
      });
      setStatsReady(true);
    };

    refreshDashboardStats();
    const unsubscribeLocalUsers = subscribeLocalUsers(refreshDashboardStats);
    const unsubscribeLocalRequests = subscribeLocalRequests(refreshDashboardStats);
    return () => {
      unsubscribeLocalUsers();
      unsubscribeLocalRequests();
    };
  }, [branchId, realtimeBranch, realtimeRequests, realtimeRequesters, realtimeUsers]);

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return registeredDistributors;

    return registeredDistributors.filter((distributor) =>
      [
        getFullName(distributor),
        distributor.username,
        distributor.userName,
        getProfileUniqueId(distributor),
        distributor.email,
        distributor.phone,
        getBarangay(distributor),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [registeredDistributors, search]);
  const registeredRequesters = useMemo(() => allRequesters, [allRequesters]);
  const filteredRequesters = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return allRequesters;

    return allRequesters.filter((requester) =>
      [
        getFullName(requester),
        requester.username,
        requester.userName,
        getProfileUniqueId(requester),
        requester.email,
        requester.phone,
        getBarangay(requester),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [allRequesters, search]);
  const activeAccounts =
    accountsTab === 'requesters' ? filteredRequesters : filteredDistributors;
  const activeAccountsLabel =
    accountsTab === 'requesters' ? 'requesters' : 'distributors';

  const { totalPages, start, end, accounts: paginatedAccounts } = useMemo(
    () => accountPageSlice(activeAccounts, currentPage),
    [activeAccounts, currentPage]
  );
  const pageNumbers = useMemo(
    () => accountPageNumbers(currentPage, totalPages),
    [currentPage, totalPages]
  );

  const handleTabChange = (tab) => {
    setAccountsTab(tab);
    setCurrentPage(1);
  };

  const handleSearchChange = (text) => {
    setSearch(text);
    setCurrentPage(1);
  };

  const barangayRows = useMemo(
    () =>
      buildBarangayRows([
        ...allUsers.filter((user) => normalizeRole(user.role) === 'distributor'),
        ...allRequesters,
      ]),
    [allUsers, allRequesters]
  );
  const trendData = useMemo(
    () => dashboardStats.salesTrend,
    [dashboardStats.salesTrend]
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


  return (
    <ManagerShell
      active="dashboard"
      title="Data overview"
      subtitle={realtimeBranch?.name ? `${realtimeBranch.name} • Your Branch Overview` : 'Your Branch Overview'}
    >
      <View style={styles.metricGrid}>
        <MetricCard
          label="OVERALL REGISTERED USERS"
          value={dashboardStats.registeredUsers}
          helper="Distributors & branch requesters"
          accent={BLUE}
          delay={0}
          enabled={statsReady}
          progress={cardProgresses[0]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="REGISTERED DISTRIBUTORS"
          value={dashboardStats.registeredDistributors}
          helper="Approved and active"
          accent={BLUE_DARK}
          delay={120}
          enabled={statsReady}
          progress={cardProgresses[1]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="REGISTERED REQUESTERS"
          value={dashboardStats.registeredRequesters}
          helper="Branch water requesters"
          accent={BLUE_MID}
          delay={240}
          enabled={statsReady}
          progress={cardProgresses[2]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="PRODUCT SALES (UNITS)"
          value={dashboardStats.productSales}
          helper="Total units delivered"
          accent={BLUE}
          delay={360}
          enabled={statsReady}
          progress={cardProgresses[3]}
          reducedMotion={reducedMotion}
        />
        <MetricCard
          label="STATIONS ONLINE"
          value="1 / 1"
          helper="Branch operational"
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
          station={branchData}
        />
      </View>

      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <View style={styles.tableHeaderLeft}>
            <Text style={styles.tableTitle}>Registered accounts</Text>
            <Text style={styles.tableRecordCount}>
              {activeAccounts.length === 0
                ? 'No matching accounts'
                : activeAccounts.length === 1
                ? '1 account matching'
                : `${activeAccounts.length} accounts matching`}
            </Text>
          </View>

          <View style={styles.tableHeaderControls}>
            <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFC' }]}>
              <AdminIcon name="search" size={16} color={colors.textSecondary} />
              <TextInput
                value={search}
                onChangeText={handleSearchChange}
                placeholder="Search name, username, ID, email..."
                placeholderTextColor={colors.placeholder || colors.textSecondary}
                style={[styles.searchInput, { color: colors.textPrimary }]}
                accessibilityLabel="Search registered accounts"
              />
              {!!search && (
                <TouchableOpacity
                  onPress={() => handleSearchChange('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                >
                  <AdminIcon name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.tableTabs}>
              <TouchableOpacity
                activeOpacity={0.82}
                accessibilityRole="tab"
                accessibilityState={{ selected: accountsTab === 'distributors' }}
                accessibilityLabel={`Distributors (${registeredDistributors.length})`}
                style={
                  accountsTab === 'distributors'
                    ? styles.tableTabActive
                    : styles.tableTab
                }
                onPress={() => handleTabChange('distributors')}
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
                accessibilityRole="tab"
                accessibilityState={{ selected: accountsTab === 'requesters' }}
                accessibilityLabel={`Requesters (${dashboardStats.registeredRequesters})`}
                style={
                  accountsTab === 'requesters'
                    ? styles.tableTabActive
                    : styles.tableTab
                }
                onPress={() => handleTabChange('requesters')}
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
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
          <View style={styles.table}>
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
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : activeAccounts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  {search.trim()
                    ? `No ${activeAccountsLabel} matching "${search.trim()}".`
                    : `No registered ${activeAccountsLabel} yet.`}
                </Text>
                {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
              </View>
            ) : (
              paginatedAccounts.map((account) => {
                const fullName = getFullName(account);
                const accountId = account.uid || account.id;
                const isDistributorRow = accountsTab === 'distributors';

                return (
                  <View key={accountId || account.email} style={styles.tableRow}>
                    <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>{fullName}</Text>
                    <Text style={[styles.td, styles.idCol]} numberOfLines={1}>{getProfileUniqueId(account) || 'Not set'}</Text>
                    <Text style={[styles.td, styles.contactCol]} numberOfLines={1}>{account.phone || 'Not set'}</Text>
                    <Text style={[styles.tdLink, styles.emailCol]} numberOfLines={1}>{account.email || 'Not set'}</Text>
                    <Text style={[styles.td, styles.barangayCol]} numberOfLines={1}>{getBarangay(account)}</Text>
                    <Text style={[styles.td, styles.joinedCol]} numberOfLines={1}>{getJoinedLabel(account)}</Text>
                    <View style={[styles.actionsCell, styles.actionsCol]}><Text style={styles.noActionText}>{isDistributorRow ? 'Managed by Admin' : 'View only'}</Text></View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {activeAccounts.length > 0 && (
          <View style={[styles.paginationBar, { borderTopColor: colors.border }]}>
            <Text style={[styles.paginationSummary, { color: colors.textSecondary }]}>
              Showing {start + 1}–{end} of {activeAccounts.length} accounts · Page {currentPage} of {totalPages}
            </Text>
            <View style={styles.paginationControls}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Previous page"
                accessibilityState={{ disabled: currentPage === 1 }}
                disabled={currentPage === 1}
                onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={[
                  styles.paginationButton,
                  {
                    backgroundColor: isDark ? colors.surfaceAlt : colors.surface,
                    borderColor: colors.border,
                  },
                  currentPage === 1 && styles.paginationDisabled,
                ]}
              >
                <Text style={[styles.paginationButtonText, { color: currentPage === 1 ? colors.muted : colors.textPrimary }]}>
                  Previous
                </Text>
              </TouchableOpacity>

              {pageNumbers.map((p, idx) =>
                typeof p === 'string' ? (
                  <Text key={`ellipsis-${idx}`} style={[styles.paginationEllipsis, { color: colors.textSecondary }]}>
                    …
                  </Text>
                ) : (
                  <TouchableOpacity
                    key={`page-${p}`}
                    accessibilityRole="button"
                    accessibilityLabel={p === currentPage ? `Current page, page ${p}` : `Go to page ${p}`}
                    accessibilityState={{ selected: p === currentPage }}
                    onPress={() => setCurrentPage(p)}
                    style={[
                      styles.paginationPageNumber,
                      {
                        backgroundColor: p === currentPage ? colors.primaryAction : (isDark ? colors.surfaceAlt : colors.surface),
                        borderColor: p === currentPage ? colors.primaryAction : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.paginationPageText,
                        { color: p === currentPage ? (colors.onPrimary || '#FFFFFF') : colors.textPrimary },
                      ]}
                    >
                      {p}
                    </Text>
                  </TouchableOpacity>
                )
              )}

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Next page"
                accessibilityState={{ disabled: currentPage === totalPages }}
                disabled={currentPage === totalPages}
                onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={[
                  styles.paginationButton,
                  {
                    backgroundColor: isDark ? colors.surfaceAlt : colors.surface,
                    borderColor: colors.border,
                  },
                  currentPage === totalPages && styles.paginationDisabled,
                ]}
              >
                <Text style={[styles.paginationButtonText, { color: currentPage === totalPages ? colors.muted : colors.textPrimary }]}>
                  Next
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </ManagerShell>
  );
}

const createStyles = (colors, width = 1200, isDark = false) => StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
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
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  metricValue: {
    color: colors.textPrimary,
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
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 16,
  },
  panel: {
    minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
  },
  trendPanel: {
    flex: 1.3,
    flexBasis: 400,
    minHeight: 310,
  },
  compositionPanel: {
    flex: 1.3,
    flexBasis: 320,
    minHeight: 310,
  },
  barangayPanel: {
    flex: 1,
    flexBasis: 280,
    minHeight: 320,
  },
  stationsPanel: {
    flex: 1,
    flexBasis: 280,
    minHeight: 320,
  },
  panelTitle: {
    color: colors.textPrimary,
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
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  lineChart: {
    flex: 1,
    minHeight: 232,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    backgroundColor: colors.border,
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
    borderColor: colors.border,
    zIndex: 2,
  },
  chartTooltip: {
    position: 'absolute',
    minWidth: 56,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: colors.textPrimary,
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
    backgroundColor: colors.surface,
  },
  donutPercent: {
    color: colors.textPrimary,
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
    color: colors.textSecondary,
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
    backgroundColor: colors.border,
  },
  barangayRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barangayLabel: {
    width: 80,
    color: colors.textPrimary,
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
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  stationSales: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  tableCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: width < 430 ? 14 : 20,
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: width < 840 ? 'column' : 'row',
    alignItems: width < 840 ? 'flex-start' : 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 16,
  },
  tableHeaderLeft: {
    minWidth: 0,
    flexShrink: 1,
  },
  tableTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  tableRecordCount: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  tableHeaderControls: {
    flexDirection: width < 540 ? 'column' : 'row',
    alignItems: width < 540 ? 'stretch' : 'center',
    gap: 10,
    width: width < 840 ? '100%' : 'auto',
    minWidth: 0,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    minWidth: 0,
    width: width < 840 ? '100%' : 260,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 13,
    paddingVertical: 6,
  },
  tableTabs: {
    flexDirection: 'row',
    flexWrap: width < 420 ? 'nowrap' : 'wrap',
    gap: 8,
    width: width < 540 ? '100%' : 'auto',
  },
  tableScroll: { flexGrow: 1 },
  table: { minWidth: 900, flexGrow: 1 },
  tableTabActive: {
    borderRadius: 20,
    backgroundColor: colors.primaryAction,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flex: width < 420 ? 1 : undefined,
  },
  tableTabActiveText: {
    color: colors.onPrimary || '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableTab: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flex: width < 420 ? 1 : undefined,
  },
  tableTabText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  tableRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
  },
  tableHeadRow: {
    minHeight: 40,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
    paddingVertical: 8,
  },
  th: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  td: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  tdName: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  tdLink: {
    color: colors.primary,
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
    flex: 0.85,
    textAlign: 'right',
  },
  actionsCell: {
    alignItems: 'flex-end',
  },
  removeButton: {
    borderRadius: 999,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: 'bold',
  },
  noActionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 8,
  },
  paginationBar: {
    flexDirection: width < 640 ? 'column' : 'row',
    alignItems: width < 640 ? 'flex-start' : 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 16,
    marginTop: 8,
    gap: 12,
  },
  paginationSummary: {
    fontSize: 13,
    fontWeight: '600',
  },
  paginationControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  paginationButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paginationButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  paginationPageNumber: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paginationPageText: {
    fontSize: 13,
    fontWeight: '700',
  },
  paginationEllipsis: {
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  paginationDisabled: {
    opacity: 0.45,
  },
});
