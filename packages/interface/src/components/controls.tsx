import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type ControlsProps = ComponentPropsWithRef<'div'>;

export function Controls(props: ControlsProps): ReactElement {
  return <div {...mergeProps<'div'>(stylex.props(styles.root), props)} />;
}

const styles = stylex.create({
  root: {display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8},
});
