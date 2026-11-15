import {mergeProps} from '@base-ui/react/merge-props';
import * as stylex from '@stylexjs/stylex';
import type {ComponentPropsWithRef, ReactElement} from 'react';

export type TableContainerProps = ComponentPropsWithRef<'div'>;

export function TableContainer(props: TableContainerProps): ReactElement {
  return <div {...mergeProps<'div'>(stylex.props(styles.container), props)} />;
}

export type TableProps = ComponentPropsWithRef<'table'>;

export function Table(props: TableProps): ReactElement {
  return <table {...mergeProps<'table'>(stylex.props(styles.table), props)} />;
}

export type TableCaptionProps = ComponentPropsWithRef<'caption'>;

export function TableCaption(props: TableCaptionProps): ReactElement {
  return <caption {...mergeProps<'caption'>(stylex.props(styles.caption), props)} />;
}

export type TableHeaderCellProps = ComponentPropsWithRef<'th'>;

export function TableHeaderCell(props: TableHeaderCellProps): ReactElement {
  return <th {...mergeProps<'th'>(stylex.props(styles.cell), props)} />;
}

export type TableCellProps = ComponentPropsWithRef<'td'>;

export function TableCell(props: TableCellProps): ReactElement {
  return <td {...mergeProps<'td'>(stylex.props(styles.cell), props)} />;
}

const styles = stylex.create({
  container: {overflowX: 'auto'},
  table: {width: '100%', borderCollapse: 'collapse', textAlign: 'left'},
  caption: {textAlign: 'left', fontWeight: 600, marginBottom: 8},
  cell: {padding: 12, borderBottom: '1px solid #ddd', overflowWrap: 'anywhere'},
});
