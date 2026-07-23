import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers } from '../../localUsers';
import { getLocalRequests } from '../../services/requests';
import AdminShell, {
  ADMIN_COLORS,
  AdminPill,
  AdminWaterDrop,
} from '../../components/AdminShell';
import {
  formatAdminNumber,
  useAnimatedNumber,
  useAnimatedValueSnapshot,
  useReducedMotionPreference,
} from '../../components/adminAnimationHooks';

const BLUE_DARK = '#0D47A1';
const BLUE = '#187BCD';
const BLUE_MID = '#42A5F5';
const BLUE_LIGHT = '#E3F2FD';
const DEFAULT_STATIONS = ['aquabea', 'bluetap'];
const LINE_THICKNESS = 3;
const BARANGAY_DONUT_LIMIT = 8;

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

const normalizeStation = (station) =>
  (station || '').toString().trim().toLowerCase();

const formatStationName = (station) => {
  const normalized = normalizeStation(station);

  if (normalized === 'bluetap') return 'BlueTap';
  if (normalized === 'aquabea') return 'Aquabea';

  return station
    .toString()
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

const getRequestQuantity = (request) => {
  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  }

  return Number(request.quantity || 0);
};

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

const buildTrend = (totalSales) => {
  const sales = Math.max(Number(totalSales || 0), 0);
  const factors = [0.52, 0.6, 0.56, 0.68, 0.76, 1];

  return ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'].map((month, index) => ({
    month,
    value: sales > 0 ? Math.round(sales * factors[index]) : 0,
  }));
};

const buildBarangayRows = (users = [], search = '') => {
  const normalizedSearch = search.trim().toLowerCase();
  const counts = new Map();

  users.forEach((user) => {
    const barangay = getBarangay(user);
    if (barangay === 'Not set') return;
    counts.set(barangay, (counts.get(barangay) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((row) => row.label.toLowerCase().includes(normalizedSearch))
    .sort((left, right) => right.value - left.value);
};

const buildStationRows = (requests = []) => {
  const stationMap = new Map();

  DEFAULT_STATIONS.forEach((station, index) => {
    stationMap.set(normalizeStation(station), {
      active: true,
      gallons: 0,
      label: formatStationName(station),
      order: index,
    });
  });

  requests.forEach((request) => {
    const rawStation =
      request.water_station ||
      request.waterStation ||
      request.station ||
      request.station_name;
    const normalized = normalizeStation(rawStation);

    if (!normalized) return;

    const existing = stationMap.get(normalized) || {
      active: true,
      gallons: 0,
      label: formatStationName(rawStation),
      order: stationMap.size,
    };

    stationMap.set(normalized, {
      ...existing,
      active: true,
      gallons: existing.gallons + getRequestQuantity(request),
    });
  });

  return Array.from(stationMap.values())
    .sort((left, right) => left.order - right.order)
    .map((station, index) => ({
      ...station,
      id: `${station.label}-${index}`,
      name: `Station ${String.fromCharCode(65 + index)} - ${station.label}`,
      sales: `${formatAdminNumber(station.gallons)} gal sold`,
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
    return formatAdminNumber(countValue);
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
        <AdminWaterDrop color={accent} size={22} />
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
                  {formatAdminNumber(tooltipPoint.value)}
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
              {formatAdminNumber(total)}
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

const StationsPanel = ({ progress, rows }) => (
  <PanelSurface progress={progress} style={styles.stationsPanel}>
    <Text style={styles.panelTitle}>Stations</Text>
    <View style={styles.stationList}>
      {rows.map((station, index) => {
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
            <AdminWaterDrop
              color={index % 2 === 0 ? BLUE : BLUE_MID}
              outline={!station.active}
              size={28}
            />
            <View style={styles.stationTextBlock}>
              <Text style={styles.stationName}>{station.name}</Text>
              <Text style={styles.stationSales}>{station.sales}</Text>
            </View>
            <AdminPill tone={station.active ? 'green' : 'red'}>
              {station.active ? 'Active' : 'Offline'}
            </AdminPill>
          </Animated.View>
        );
      })}
    </View>
  </PanelSurface>
);

export default function AdminAnalyticsPage() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [productSales, setProductSales] = useState(0);
  const [dataReady, setDataReady] = useState(false);
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
    let firestoreUsers = [];
    let firestoreRequests = [];

    const refreshAnalytics = () => {
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

      setUsers(mergedUsers);
      setRequests(allRequests);
      setProductSales(
        allRequests.reduce((sum, request) => sum + getRequestQuantity(request), 0)
      );
      setDataReady(true);
    };

    refreshAnalytics();
    const unsubscribeLocalUsers = subscribeLocalUsers(refreshAnalytics);

    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        firestoreUsers = snapshot.docs.map((item) => ({
          id: item.id,
          uid: item.id,
          ...item.data(),
        }));
        refreshAnalytics();
      },
      (error) => {
        console.log('Analytics users error:', error.message);
        refreshAnalytics();
      }
    );

    const unsubscribeRequests = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        firestoreRequests = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        refreshAnalytics();
      },
      (error) => {
        console.log('Analytics requests error:', error.message);
        refreshAnalytics();
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeRequests();
      unsubscribeLocalUsers();
    };
  }, []);

  useEffect(() => {
    if (!dataReady || hasAnimated.current) return;

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
    dataReady,
    legendProgresses,
    lineProgress,
    panelProgress,
    pointProgresses,
    reducedMotion,
    stationProgress,
  ]);

  const distributorCount = users.filter(
    (user) => normalizeRole(user.role) === 'distributor'
  ).length;
  const requesterCount = users.filter(
    (user) => normalizeRole(user.role) === 'requester'
  ).length;
  const totalUsers = users.length;
  const distributorShare =
    totalUsers > 0 ? Math.round((distributorCount / totalUsers) * 100) : 0;
  const requesterShare =
    totalUsers > 0 ? Math.round((requesterCount / totalUsers) * 100) : 0;
  const trendData = useMemo(() => buildTrend(productSales), [productSales]);
  const barangayRows = useMemo(
    () => buildBarangayRows(users, search),
    [search, users]
  );
  const stationRows = useMemo(() => buildStationRows(requests), [requests]);
  const onlineStations = stationRows.filter((station) => station.active).length;
  const offlineStations = Math.max(stationRows.length - onlineStations, 0);

  return (
    <AdminShell
      active="analytics"
      title="Analytics"
      subtitle="Sales, users, and barangay breakdowns"
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search barangay..."
    >
      <View style={styles.metricGrid}>
        <MetricCard
          accent={BLUE}
          delay={0}
          enabled={dataReady}
          helper={`${totalUsers} total accounts`}
          label="OVERALL REGISTERED USERS"
          progress={cardProgresses[0]}
          reducedMotion={reducedMotion}
          value={totalUsers}
        />
        <MetricCard
          accent={BLUE_DARK}
          delay={120}
          enabled={dataReady}
          helper={`${distributorShare}% of user base`}
          label="REGISTERED DISTRIBUTORS"
          progress={cardProgresses[1]}
          reducedMotion={reducedMotion}
          value={distributorCount}
        />
        <MetricCard
          accent={BLUE_MID}
          delay={240}
          enabled={dataReady}
          helper={`${requesterShare}% of user base`}
          label="REGISTERED REQUESTERS"
          progress={cardProgresses[2]}
          reducedMotion={reducedMotion}
          value={requesterCount}
        />
        <MetricCard
          accent={BLUE}
          delay={360}
          enabled={dataReady}
          helper="Total ordered"
          label="PRODUCT SALES (GALLONS)"
          progress={cardProgresses[3]}
          reducedMotion={reducedMotion}
          value={productSales}
        />
        <MetricCard
          accent={offlineStations > 0 ? ADMIN_COLORS.red : BLUE_MID}
          delay={480}
          enabled={dataReady}
          helper={
            offlineStations > 0
              ? `${offlineStations} station offline`
              : 'All stations active'
          }
          label="STATIONS ONLINE"
          progress={cardProgresses[4]}
          reducedMotion={reducedMotion}
          value={`${onlineStations} / ${stationRows.length}`}
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
          distributors={distributorCount}
          legendProgresses={legendProgresses}
          panelProgress={panelProgress}
          requesters={requesterCount}
        />
        <StationsPanel progress={stationProgress} rows={stationRows} />
      </View>
    </AdminShell>
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
    backgroundColor: ADMIN_COLORS.card,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
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
    color: ADMIN_COLORS.muted,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  metricValue: {
    color: ADMIN_COLORS.text,
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
    backgroundColor: ADMIN_COLORS.card,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
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
    color: ADMIN_COLORS.text,
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
    color: ADMIN_COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  lineChart: {
    flex: 1,
    minHeight: 232,
    borderBottomWidth: 1,
    borderBottomColor: ADMIN_COLORS.border,
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
    backgroundColor: ADMIN_COLORS.border,
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
    backgroundColor: ADMIN_COLORS.text,
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
    color: ADMIN_COLORS.text,
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
    color: ADMIN_COLORS.muted,
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
    backgroundColor: ADMIN_COLORS.border,
  },
  barangayRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barangayLabel: {
    width: 80,
    color: ADMIN_COLORS.text,
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
    color: ADMIN_COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  stationSales: {
    color: ADMIN_COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
