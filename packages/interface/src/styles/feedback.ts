import * as stylex from '@stylexjs/stylex';
import {colors} from './colors.stylex';
import {spacing} from './spacing.stylex';
import {typography} from './typography.stylex';
import {radii} from './radii.stylex';

export const feedbackStyles = stylex.create({
  label: {fontFamily: typography.mono, fontSize: typography.label, fontWeight: 400},
  error: {color: colors.errorText, fontSize: typography.small, marginTop: spacing.xs},
  success: {
    color: colors.successText,
    backgroundColor: colors.successBackground,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  alert: {
    color: colors.errorText,
    backgroundColor: colors.errorBackground,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
});
