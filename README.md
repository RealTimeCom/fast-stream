## Fast Stream

**Fast Stream HTTP Server**

```sh
$ npm install fast-stream
```
Simple server configuration `config`, serve all requests with `200` OK.
```js
const http = require('fast-stream');
const config = {
    '*': { /*host name "*" serve all hosts request*/
        404: cb => cb('<html><body><h3>Hello World!</h3></body></html>', null, 200)
    }
};
require('net').createServer(
    socket => socket.pipe(new http(config)).pipe(socket)
).listen(80);
```
`config` for files or readable streams.
```js
const http = require('fast-stream'), fs = require('fs');
const config = {
    '*': {
        GET: {
            '/favicon.ico': cb => cb({
                src: '/dir/favicon.ico' /*source: file path*/
            }, { /*additional header*/
                'Content-Type': http.type['ico']
            }),
            '/vid.mp4': cb => cb({
                src: fs.createReadStream('/dir/vid.mp4'), /*source: readable stream*/
                length: 31491130 /*length (data size) required for readable stream*/
            }, { /*additional headers*/
                'Content-Type': http.type['mp4'],
                'Content-Disposition': 'inline', /*display in browser*/
                'Content-Duration': 171, /*required for web video player*/
                'X-Content-Duration': 171  /*video duration in seconds*/
            })
        }
    }
};
```
--------------------------------------------------------
**Fast Stream** is licensed under the MIT license. See the included `LICENSE` file for more details.
