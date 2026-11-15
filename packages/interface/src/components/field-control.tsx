import {Field} from '@base-ui/react/field';
import {mergeClassNames} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type FieldControlProps = ComponentPropsWithRef<typeof Field.Control>;

export function FieldControl({className, ...props}: FieldControlProps): ReactElement {
  return (
    <Field.Control
      {...props}
      className={state =>
        mergeClassNames(
          stylex.props(styles.root).className,
          typeof className === 'function' ? className(state) : className
        )
      }
    />
  );
}

const styles = stylex.create({
  root: {
    flexGrow: 1,
    minWidth: 200,
    padding: 10,
    font: 'inherit',
    border: '1px solid #aaa',
    borderRadius: 4,
  },
});
