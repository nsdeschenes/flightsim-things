import {Button as BaseButton} from '@base-ui/react/button';
import {mergeClassNames} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type ButtonProps = ComponentPropsWithRef<typeof BaseButton>;

export function Button({className, ...props}: ButtonProps): ReactElement {
  return (
    <BaseButton
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

const styles = stylex.create({root: {padding: 10, font: 'inherit', cursor: 'pointer'}});
