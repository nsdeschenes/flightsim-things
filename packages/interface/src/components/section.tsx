import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import {colors} from '../styles/colors.stylex';
import {spacing} from '../styles/spacing.stylex';
import {radii} from '../styles/radii.stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type SectionProps = ComponentPropsWithRef<'section'>;

export function Section(props: SectionProps): ReactElement {
  return <section {...mergeProps<'section'>(stylex.props(styles.root), props)} />;
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: {default: spacing.xl, '@media (max-width: 700px)': spacing.lg},
    backgroundColor: colors.surface,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.border,
  },
});
