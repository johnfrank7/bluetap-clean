import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';
import BlueTapIcon from './BlueTapIcon';

export function clockParts(date) {
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  return {
    time: `${String(hour12).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
}

export function calendarParts(date) {
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'long' }),
    date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

export default function LocalTimeCard({ compact = false, onBrand = false, style }) {
  const { colors } = useBlueTapTheme();
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    let minuteInterval;
    const update = () => setNow(new Date());
    const boundaryDelay = 60000 - (Date.now() % 60000) + 20;
    const boundaryTimer = setTimeout(() => {
      update();
      minuteInterval = setInterval(update, 60000);
    }, boundaryDelay);
    return () => {
      clearTimeout(boundaryTimer);
      if (minuteInterval) clearInterval(minuteInterval);
    };
  }, []);

  const { time, period } = clockParts(now);
  const { weekday, date } = calendarParts(now);
  const daytime = now.getHours() >= 6 && now.getHours() < 18;
  const sunColor = onBrand ? '#FFD54F' : '#F59E0B';
  const primaryColor = onBrand ? '#FFFFFF' : (colors.iconInteractive || colors.primary);
  const secondaryColor = onBrand ? '#DDF2FF' : colors.textSecondary;
  return (
    <View
      accessibilityLabel={`Local time ${time} ${period}, ${weekday}, ${date}`}
      accessibilityLiveRegion="none"
      accessibilityRole="text"
      style={[
        styles.clock,
        compact && styles.clockCompact,
        { borderColor: onBrand ? 'rgba(255,255,255,0.28)' : colors.border },
        style,
      ]}
    >
      <View style={styles.timeRow}>
        <View style={[styles.periodIcon, { width: compact ? 15 : 17, height: compact ? 15 : 17 }]}>
          <BlueTapIcon name={daytime ? 'sun' : 'moon'} size={compact ? 14 : 16} color={daytime ? sunColor : primaryColor} />
          {!daytime && <BlueTapIcon name="star" size={6} color="#F4B942" style={styles.periodStar} />}
        </View>
        <Text style={[styles.time, compact && styles.timeCompact, { color: primaryColor }]}>{time}</Text>
        <Text style={[styles.period, { color: primaryColor }]}>{period}</Text>
      </View>
      {compact ? (
        <View style={styles.dateGroup}>
          <Text numberOfLines={1} style={[styles.date, { color: secondaryColor }]}>{weekday}</Text>
          <Text numberOfLines={1} style={[styles.date, { color: secondaryColor }]}>{date}</Text>
        </View>
      ) : <Text numberOfLines={1} style={[styles.date, { color: secondaryColor }]}>{`${weekday} \u00B7 ${date}`}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  clock: {
    minWidth: 158,
    borderLeftWidth: 1,
    paddingLeft: 16,
    paddingVertical: 2,
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  clockCompact: { minWidth: 122, paddingLeft: 9 },
  timeRow: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'flex-start' },
  periodIcon: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  periodStar: { position: 'absolute', right: -2, top: -3 },
  time: { fontSize: 25, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: 0.4 },
  timeCompact: { fontSize: 20, letterSpacing: 0 },
  period: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  dateGroup: { marginTop: 1 },
  date: { fontSize: 11, fontWeight: '700', marginTop: 2, textAlign: 'left' },
});
