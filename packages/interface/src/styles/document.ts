import * as stylex from '@stylexjs/stylex';
import {colors} from './colors.stylex';
import {typography} from './typography.stylex';

export const documentStyles = stylex.create({
  root: {
    colorScheme: 'light',
    color: colors.text,
    backgroundColor: colors.pageBackground,
    fontFamily: typography.family,
    fontSize: typography.body,
    lineHeight: typography.lineHeight,
  },
});
