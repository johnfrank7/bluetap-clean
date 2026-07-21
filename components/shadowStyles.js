import { Platform } from 'react-native';

const toRgb = (color) => {
  if (typeof color !== 'string') return null;

  const value = color.trim().replace('#', '');
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(value)) return null;

  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;

  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
};

const getShadowColor = (color, opacity) => {
  const rgb = toRgb(color);
  return rgb ? `rgba(${rgb.join(', ')}, ${opacity})` : color;
};

export const createShadow = ({
  color = '#000',
  elevation = 0,
  offset = { width: 0, height: 2 },
  opacity = 0.12,
  radius = 8,
} = {}) =>
  Platform.select({
    web: {
      boxShadow: `${offset.width}px ${offset.height}px ${radius}px ${getShadowColor(
        color,
        opacity
      )}`,
    },
    default: {
      elevation,
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: offset,
    },
  });
