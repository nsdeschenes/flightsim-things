import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type HeadingProps = ComponentPropsWithRef<'h2'> & {as?: 'h2' | 'h3'};

export function Heading({as: Tag = 'h2', ...props}: HeadingProps): ReactElement {
  return <Tag {...mergeProps<'h2'>(stylex.props(styles.root), props)} />;
}

const styles = stylex.create({
  root: {fontSize: 24, marginTop: 0, marginBottom: 20},
});
