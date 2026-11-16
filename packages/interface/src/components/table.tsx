import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import {colors} from '../styles/colors.stylex';
import {spacing} from '../styles/spacing.stylex';
import {typography} from '../styles/typography.stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type TableContainerProps = ComponentPropsWithRef<'div'>;

export function TableContainer(props: TableContainerProps): ReactElement {
  return <div {...mergeProps<'div'>(stylex.props(styles.container), props)} />;
}

export type TableProps = ComponentPropsWithRef<'table'>;

export function Table(props: TableProps): ReactElement {
  return <table {...mergeProps<'table'>(stylex.props(styles.table), props)} />;
}

export function TableRow(props: ComponentPropsWithRef<'tr'>): ReactElement {
  return <tr {...mergeProps<'tr'>(stylex.props(styles.row), props)} />;
}

export type TableCaptionProps = ComponentPropsWithRef<'caption'>;

export function TableCaption(props: TableCaptionProps): ReactElement {
  return <caption {...mergeProps<'caption'>(stylex.props(styles.caption), props)} />;
}

export type TableHeaderCellProps = ComponentPropsWithRef<'th'>;

export function TableHeaderCell(props: TableHeaderCellProps): ReactElement {
  return <th {...mergeProps<'th'>(stylex.props(styles.cell, styles.header), props)} />;
}

export type TableCellProps = ComponentPropsWithRef<'td'>;

export function TableCell(props: TableCellProps): ReactElement {
  return <td {...mergeProps<'td'>(stylex.props(styles.cell), props)} />;
}

const styles = stylex.create({
  row: {
    backgroundColor: {
      default: colors.transparent,
      ':hover': colors.workspace,
      ':is([aria-selected="true"])': colors.selected,
    },
    color: colors.text,
  },
  container: {overflowX: 'auto', marginTop: spacing.lg},
  table: {width: '100%', minWidth: 640, borderCollapse: 'collapse', textAlign: 'left'},
  caption: {textAlign: 'left', fontWeight: 600, marginBottom: spacing.sm},
  header: {
    backgroundColor: colors.workspace,
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: typography.medium,
  },
  cell: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    overflowWrap: 'anywhere',
  },
});
