import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme/tokens';

const TRACK_W = 54;
const TRACK_H = 33;
const KNOB = 27;
const KNOB_OFF_X = 3;
const KNOB_ON_X = TRACK_W - KNOB - KNOB_OFF_X; // 24

type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * 54×33 pill switch. Off = warm gray, on = coral. The touch zone is a full
 * 48pt — the visible pill sits inside it. Always role="switch" +
 * accessibilityState so state is never color-alone.
 */
export default function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  style,
  testID,
}: ToggleProps) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.toggleOff, colors.coral],
  });
  const knobX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [KNOB_OFF_X, KNOB_ON_X],
  });

  return (
    <Pressable
      testID={testID}
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      style={[styles.hitZone, disabled && styles.disabled, style]}
      hitSlop={0}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.knob, { left: knobX }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitZone: {
    minHeight: 48,
    minWidth: 64,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
  },
  knob: {
    position: 'absolute',
    top: KNOB_OFF_X,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: colors.ink,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
});
