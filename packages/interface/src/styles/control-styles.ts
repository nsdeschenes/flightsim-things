import * as stylex from '@stylexjs/stylex';
import {colors} from './colors.stylex';
import {controls} from './controls.stylex';
import {radii} from './radii.stylex';
import {spacing} from './spacing.stylex';
import {typography} from './typography.stylex';

export const controlStyles = stylex.create({
  root: {
    minHeight: controls.height,
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    borderWidth: controls.borderWidth,
    borderStyle: 'solid',
    borderColor: {
      default: colors.controlBorder,
      ':hover': colors.primary,
      ':is([data-invalid])': colors.errorText,
    },
    borderRadius: radii.control,
    backgroundColor: {
      default: colors.surface,
      ':disabled': colors.disabledBackground,
      ':is([data-disabled])': colors.disabledBackground,
    },
    color: {
      default: colors.text,
      ':disabled': colors.disabledText,
      ':is([data-disabled])': colors.disabledText,
    },
    fontSize: typography.body,
    lineHeight: typography.lineHeight,
    outlineColor: colors.focusRing,
    outlineStyle: {default: 'none', ':focus-visible': 'solid'},
    outlineWidth: controls.focusWidth,
    outlineOffset: controls.focusOffset,
    cursor: {default: 'pointer', ':disabled': 'not-allowed'},
  },
  tooltip: {
    padding: spacing.sm,
    backgroundColor: colors.tooltipBackground,
    color: colors.tooltipText,
    borderRadius: radii.control,
    fontSize: typography.small,
    maxWidth: 'min(400px, calc(100vw - 24px))',
    overflowWrap: 'anywhere',
    zIndex: 20,
  },
});
