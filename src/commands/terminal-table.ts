import path from 'node:path';
import {pathToFileURL} from 'node:url';

type TableColumn<Row> =
  | Readonly<{header: string; key: keyof Row}>
  | Readonly<{header: string; directory: (row: Readonly<Row>) => string}>;

type Cell = Readonly<{text: string; url?: string}>;

const cellPadding = 2;
const firstRowIndex = 0;
const headerRowCount = 1;
const controlCharacters = /\p{Cc}/gu;

function formatCell({text, url}: Cell, width: number): string {
  let content = text;
  if (typeof url === 'string') {
    content = `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
  }

  return content + ' '.repeat(width - Bun.stringWidth(text));
}

function columnCell<Row>(row: Readonly<Row>, column: TableColumn<Row>): Cell {
  let value = '';
  if ('directory' in column) {
    value = column.directory(row);
  }

  if ('key' in column) {
    value = String(row[column.key] ?? '');
  }

  const text = Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
  if ('directory' in column) {
    return {text, url: pathToFileURL(path.join(value, path.sep)).href};
  }

  return {text};
}

function formatTable<Row>(
  rows: readonly Readonly<Row>[],
  columns: readonly TableColumn<Row>[]
): string {
  const tableColumns: readonly Readonly<{cells: readonly Cell[]; width: number}>[] =
    columns.map(column => {
      const cells: readonly Cell[] = [
        {text: column.header},
        ...rows.map(row => columnCell(row, column)),
      ];
      let width = Bun.stringWidth(column.header);
      for (const cell of cells) {
        width = Math.max(width, Bun.stringWidth(cell.text));
      }

      return {cells, width};
    });
  const border = `+${tableColumns.map(column => '-'.repeat(column.width + cellPadding)).join('+')}+`;
  const lines = Array.from({length: rows.length + headerRowCount}, (_value, rowIndex) => {
    const line = `| ${tableColumns
      .map(column => formatCell(column.cells[rowIndex] ?? {text: ''}, column.width))
      .join(' | ')} |`;
    if (rowIndex === firstRowIndex) {
      return `${line}\n${border}`;
    }

    return line;
  });
  return [border, ...lines, border].join('\n');
}

export default formatTable;
