type SavedList = Readonly<{
  message: string;
  emptyMessage: string;
  choices: readonly Readonly<{
    title: string;
    description?: string;
    value: () => string;
  }>[];
}>;

export type {SavedList as default};
