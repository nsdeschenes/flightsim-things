import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import {spacing} from '../styles/spacing.stylex';
import {typography} from '../styles/typography.stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type HeadingProps = ComponentPropsWithRef<'h2'> & {as?: 'h2' | 'h3'};

export function Heading({as: Tag = 'h2', ...props}: HeadingProps): ReactElement {
  return (
    <Tag
      {...mergeProps<'h2'>(
        stylex.props(styles.root, Tag === 'h3' && styles.subheading),
        props
      )}
    />
  );
}

const styles = stylex.create({
  subheading: {
    fontSize: typography.title,
    letterSpacing: '-0.2px',
    marginBottom: spacing.sm,
  },
  root: {
    fontSize: typography.heading,
    fontWeight: typography.medium,
    letterSpacing: '-0.6px',
    marginTop: 0,
    marginBottom: spacing.lg,
  },
});
