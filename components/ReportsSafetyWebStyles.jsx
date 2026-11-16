import React from 'react';
import { Platform } from 'react-native';

// The web button reset follows React Native Web's generated classes. Keep these
// overrides limited to Reports & Safety controls whose fills carry meaning.
export default function ReportsSafetyWebStyles({ colors }) {
  if (Platform.OS !== 'web') return null;
  return React.createElement('style', { dangerouslySetInnerHTML: { __html: `
    [data-safety-button="primary"] { background-color: ${colors.primaryAction} !important; border-color: ${colors.primaryAction} !important; }
    [data-safety-button="primary"] :is(div, span) { color: ${colors.onPrimary} !important; }
    [data-safety-button="disabled"] { background-color: ${colors.neutral} !important; border-color: ${colors.border} !important; opacity: 1 !important; }
    [data-safety-button="disabled"] :is(div, span) { color: ${colors.disabledText} !important; }
    [data-safety-choice="selected"] { background-color: ${colors.primarySoft} !important; border-color: ${colors.iconPrimary} !important; }
  ` } });
}
