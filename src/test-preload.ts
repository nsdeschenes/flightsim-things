import {afterAll, afterEach, beforeAll, expect} from 'bun:test';

import testHttp from './test-http.ts';

const unhandledRequests: string[] = [];

beforeAll(() => {
  testHttp.server.listen({
    onUnhandledRequest: (
      request: Readonly<Pick<Request, 'method' | 'url'>>,
      print: Readonly<{error: () => void}>
    ) => {
      unhandledRequests.push(`${request.method} ${request.url}`);
      print.error();
    },
  });
});

afterEach(() => {
  testHttp.server.resetHandlers();
  testHttp.requests.length = 0;
  const unexpected = [...unhandledRequests];
  unhandledRequests.length = 0;
  expect(unexpected).toEqual([]);
});

afterAll(() => {
  testHttp.server.close();
});
