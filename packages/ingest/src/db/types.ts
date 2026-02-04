export type SqlQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
};

export type SqlExecutor = {
  query<Row extends Record<string, unknown>>(
    text: string,
    params?: Array<unknown>
  ): Promise<SqlQueryResult<Row>>;
};
