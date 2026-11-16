import {Field} from '@base-ui/react/field';
import {mergeClassNames} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import {controlStyles} from '../styles/control-styles';
import {colors} from '../styles/colors.stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type FieldControlProps = ComponentPropsWithRef<typeof Field.Control>;

export function FieldControl({className, ...props}: FieldControlProps): ReactElement {
  return (
    <Field.Control
      {...props}
      className={state =>
        mergeClassNames(
          stylex.props(controlStyles.root, styles.root).className,
          typeof className === 'function' ? className(state) : className
        )
      }
    />
  );
}

const styles = stylex.create({
  root: {
    flexGrow: 1,
    minWidth: 0,
    width: 220,
    maxWidth: '100%',
    cursor: 'text',
    '::placeholder': {color: colors.textMuted, opacity: 1},
  },
});
