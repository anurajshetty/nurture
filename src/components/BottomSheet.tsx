import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoid } from './KeyboardAvoid';
import { colors, radii, spacing } from '../theme/tokens';

const { height: SCREEN_H } = Dimensions.get('window');
const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.9;

type BottomSheetProps = {
  visible: boolean;
  /** Fires after the dismiss animation completes. Parent should set visible=false here. */
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * 24pt top radius, grabber, swipe-to-dismiss. Slides up on open, slides
 * down on backdrop tap / swipe down / Android back. Exit animation plays
 * before onClose fires, so parents just flip `visible` back to false.
 */
export default function BottomSheet({
  visible,
  onClose,
  children,
  style,
  accessibilityLabel,
  testID,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(SCREEN_H * 0.6);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: sheetHeight.current,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMounted(false);
      closing.current = false;
      onCloseRef.current();
    });
  }, [translateY, scrimOpacity]);

  // Open: mount, then animate in.
  useEffect(() => {
    if (visible && !mounted) setMounted(true);
  }, [visible, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (visible && !closing.current) {
      translateY.setValue(SCREEN_H);
      scrimOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && !closing.current) {
      // Parent flipped visible off directly (e.g. an in-sheet Close button)
      // — play the exit animation instead of unmounting abruptly.
      dismiss();
    }
  }, [mounted, visible, dismiss, translateY, scrimOpacity]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gesture) => gesture.dy > 4,
      onPanResponderMove: (_e, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_e, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 140,
            friction: 20,
          }).start();
        }
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      {/* KeyboardAvoid wraps the fill (not just the children): on iOS the
          padding shift lifts the bottom-anchored sheet above the keyboard,
          so every sheet text field (appointment, journal, questions,
          account name, consent-free inputs) stays visible. Sheets without
          text inputs never summon the keyboard, so this is a no-op there. */}
      <KeyboardAvoid style={styles.fill} testID={testID}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY }],
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm,
            },
            style,
          ]}
          onLayout={(e) => {
            sheetHeight.current = e.nativeEvent.layout.height;
          }}
          accessibilityLabel={accessibilityLabel}
        >
          <View
            {...pan.panHandlers}
            style={styles.grabZone}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Drag down to dismiss"
          >
            <View style={styles.grab} />
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoid>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(47, 43, 39, 0.32)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.xl,
    maxHeight: '86%',
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  grabZone: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  grab: {
    width: 40,
    height: 5,
    borderRadius: radii.chip,
    backgroundColor: colors.line,
  },
});
