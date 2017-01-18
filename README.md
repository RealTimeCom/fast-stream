## Fast Stream

**Fast Stream HTTP Server**

```sh
$ npm install fast-stream
```
Simple configuration, serve all requests from `404` with `200` OK.
```js
const http = require('fast-stream');

const config = {
  'localhost:80':{ // hostname:port
    404: cb => cb('<html><body><h3>Hello ' + this.remoteAddress + '</h3></body></html>', null, 200)
  }
};

require('net').createServer(socket => {
    console.log('client connected', socket.remoteAddress);
    socket.
    on('error', e => console.log('socket error', e.toString())).
    on('end', () => console.log('socket end')).
    on('close', () => console.log('socket close')).
    pipe(new http(config)).
    on('httpError', e => console.log('httpError', e.toString())).
    pipe(socket);
}).
on('error', e => console.log('server error', e.toString())).
listen(80, 'localhost', function() {
    console.log('server start', this.address());
});
```
