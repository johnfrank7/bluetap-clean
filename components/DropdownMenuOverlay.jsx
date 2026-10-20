import React from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

const EDGE_GAP = 8;
const MENU_GAP = 6;

export default function DropdownMenuOverlay({
  accessibilityLabel = 'Close dropdown',
  anchorRef,
  children,
  maxHeight = 320,
  maxWidth = 400,
  minWidth = 180,
  onDismiss,
  visible,
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [mounted, setMounted] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const progress = React.useRef(new Animated.Value(0)).current;
  const mountedRef = React.useRef(false);

  const setMountedState = React.useCallback((next) => {
    mountedRef.current = next;
    setMounted(next);
  }, []);

  React.useEffect(() => {
    if (!visible) {
      if (!mountedRef.current) return undefined;
      const animation = Animated.timing(progress, {
        toValue: 0,
        duration: 120,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start(({ finished }) => {
        if (finished) setMountedState(false);
      });
      return () => animation.stop();
    }

    setMountedState(true);
    setAnchor(null);
    const frame = requestAnimationFrame(() => {
      const trigger = anchorRef?.current;
      if (typeof trigger?.measureInWindow !== 'function') return;
      trigger.measureInWindow((x, y, width, height) => {
        if ([x, y, width, height].every(Number.isFinite)) setAnchor({ x, y, width, height });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, progress, setMountedState, visible]);

  React.useEffect(() => {
    if (!visible || !anchor) return undefined;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [anchor, progress, visible]);

  if (!mounted) return null;

  let menuPosition = null;
  if (anchor) {
    const width = Math.min(Math.max(anchor.width, minWidth), maxWidth, windowWidth - EDGE_GAP * 2);
    const left = Math.max(EDGE_GAP, Math.min(anchor.x, windowWidth - width - EDGE_GAP));
    const top = anchor.y + anchor.height + MENU_GAP;
    const availableHeight = Math.max(0, windowHeight - top - EDGE_GAP);
    const availableMaxHeight = Math.max(100, Math.min(maxHeight, availableHeight));
    menuPosition = { left, maxHeight: availableMaxHeight, top, width };
  }

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 0],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.screen}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={onDismiss}
          style={styles.backdrop}
        />
        {menuPosition ? (
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.menu,
              {
                left: menuPosition.left,
                maxHeight: menuPosition.maxHeight,
                opacity: progress,
                top: menuPosition.top,
                transform: [{ translateY }],
                width: menuPosition.width,
              },
            ]}
          >
            {children}
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = {
  screen: { flex: 1 },
  backdrop: StyleSheet.absoluteFillObject,
  menu: { position: 'absolute', zIndex: 1 },
};
