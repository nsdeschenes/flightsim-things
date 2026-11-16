import {Button as BaseButton} from '@base-ui/react/button';
import {mergeClassNames} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import {controlStyles} from '../styles/control-styles';
import {colors} from '../styles/colors.stylex';
import {typography} from '../styles/typography.stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type ButtonProps = ComponentPropsWithRef<typeof BaseButton>;

export function Button({className, ...props}: ButtonProps): ReactElement {
  return (
    <BaseButton
      {...props}
      className={state =>
        mergeClassNames(
          stylex.props(
            controlStyles.root,
            styles.root,
            props.type === 'submit' && styles.primary,
            (props['aria-pressed'] === true || props['aria-pressed'] === 'true') &&
              styles.selected,
            state.disabled && styles.disabled
          ).className,
          typeof className === 'function' ? className(state) : className
        )
      }
    />
  );
}

const styles = stylex.create({
  root: {
    fontWeight: typography.medium,
    borderWidth: 0,
    backgroundColor: {default: colors.transparent, ':hover': colors.surfaceHover},
    color: colors.primary,
  },
  primary: {
    backgroundColor: {default: colors.primary, ':hover': colors.primaryHover},
    color: colors.onPrimary,
  },
  selected: {
    backgroundColor: {default: colors.selected, ':hover': colors.selected},
    color: colors.onSelected,
  },
  disabled: {
    backgroundColor: {
      default: colors.disabledBackground,
      ':hover': colors.disabledBackground,
    },
    color: colors.disabledText,
  },
});
