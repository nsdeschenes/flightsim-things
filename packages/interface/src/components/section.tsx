import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type SectionProps = ComponentPropsWithRef<'section'>;

export function Section(props: SectionProps): ReactElement {
  return <section {...mergeProps<'section'>(stylex.props(styles.root), props)} />;
}

const styles = stylex.create({
  root: {
    marginTop: 32,
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    border: '1px solid #ddd',
  },
});
