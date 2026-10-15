import {setupServer} from 'msw/node';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type TestRequest = DeepReadonly<Request>;

const server = setupServer();
const requests: TestRequest[] = [];

server.events.on('request:start', ({request}: Readonly<{request: TestRequest}>) => {
  requests.push(request);
});

const testHttp = {requests, server};
export default testHttp;
