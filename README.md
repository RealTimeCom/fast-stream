## Fast Stream

**Fast Stream HTTP Server**

```sh
$ npm install fast-stream
```
Simple configuration, serve all requests `200` OK.
```js
const http = require('fast-stream');

const config = {
    '*': {
        404: cb => cb('<html><body><h3>Hello World!</h3></body></html>', null, 200)
    }
};
require('net').createServer(
  socket => socket.pipe(new http(config)).pipe(socket)
).listen(80);
```
